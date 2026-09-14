// Servidor HTTP sem dependências: serve a aplicação e expõe a API.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { config } from './config.js';
import { abrirBanco } from './banco.js';
import {
  criarToken, lerToken, cookieDeSessao, cookieDeSaida, lerCookies, NOME_COOKIE,
  registrarFalha, limparFalhas, bloqueado,
} from './sessao.js';
import {
  autenticar, aplicarMutacoes, estadoCompleto, estadoDesde, salvarConfiguracoes,
  criarUsuario, definirSenha, usuarioPorId, publicarUsuario, prepararBase, ErroDeUso,
} from './servico.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "connect-src 'self'", "form-action 'self'",
  "frame-ancestors 'none'", "base-uri 'self'",
].join('; ');

function cabecalhosBase(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP,
    ...extra,
  };
}

const responder = (res, status, dados, extra = {}) => {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, cabecalhosBase({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
    ...extra,
  }));
  res.end(corpo);
};

function lerCorpo(req) {
  return new Promise((aceitar, recusar) => {
    let total = 0;
    const partes = [];
    req.on('data', (parte) => {
      total += parte.length;
      if (total > config.limiteCorpoBytes) {
        recusar(new ErroDeUso('Conteúdo acima do limite permitido.', 413));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      if (!partes.length) return aceitar({});
      try { aceitar(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch { recusar(new ErroDeUso('Corpo da requisição inválido.')); }
    });
    req.on('error', recusar);
  });
}

const usuarioDaRequisicao = (req) => {
  const carga = lerToken(lerCookies(req.headers.cookie)[NOME_COOKIE]);
  if (!carga) return null;
  const u = usuarioPorId(carga.usuarioId);
  return u && u.ativo !== false && !u.excluidoEm ? u : null;
};

/* Cabeçalho próprio em toda gravação: bloqueia requisição forjada de outro site,
   que não consegue definir cabeçalhos personalizados sem autorização de origem. */
const origemConfiavel = (req) => req.headers['x-requisicao'] === 'sentinela';

async function api(req, res, url) {
  const rota = url.pathname.replace(/^\/api/, '') || '/';
  const metodo = req.method;

  if (rota === '/saude') {
    return responder(res, 200, { ok: true, servico: 'sentinela', versao: 1 });
  }

  if (rota === '/sessao' && metodo === 'POST') {
    if (!origemConfiavel(req)) return responder(res, 403, { erro: 'Requisição não autorizada.' });
    const { email, senha } = await lerCorpo(req);
    const chave = `${String(email).toLowerCase()}|${req.socket.remoteAddress}`;
    const espera = bloqueado(chave);
    if (espera) {
      return responder(res, 429, { erro: `Muitas tentativas. Tente novamente em ${espera} segundos.` });
    }
    try {
      const usuario = autenticar(email, senha);
      limparFalhas(chave);
      return responder(res, 200, { usuario }, { 'Set-Cookie': cookieDeSessao(criarToken(usuario.id)) });
    } catch (e) {
      registrarFalha(chave);
      return responder(res, e.status || 401, { erro: e.message });
    }
  }

  if (rota === '/sessao' && metodo === 'DELETE') {
    return responder(res, 200, { ok: true }, { 'Set-Cookie': cookieDeSaida() });
  }

  const usuario = usuarioDaRequisicao(req);

  if (rota === '/sessao' && metodo === 'GET') {
    return usuario
      ? responder(res, 200, { usuario: publicarUsuario(usuario) })
      : responder(res, 401, { erro: 'Sessão não encontrada.' });
  }

  if (!usuario) return responder(res, 401, { erro: 'Autentique-se para continuar.' });
  if (metodo !== 'GET' && !origemConfiavel(req)) {
    return responder(res, 403, { erro: 'Requisição não autorizada.' });
  }

  if (rota === '/estado' && metodo === 'GET') {
    const desde = url.searchParams.get('desde');
    return responder(res, 200, desde ? estadoDesde(desde) : estadoCompleto());
  }

  if (rota === '/mutacoes' && metodo === 'POST') {
    const { mutacoes } = await lerCorpo(req);
    if (!Array.isArray(mutacoes)) return responder(res, 400, { erro: 'Envie a lista de mutações.' });
    if (mutacoes.length > 500) return responder(res, 400, { erro: 'Lote acima de 500 operações.' });
    return responder(res, 200, aplicarMutacoes(mutacoes, usuario));
  }

  if (rota === '/configuracoes' && metodo === 'PUT') {
    const corpo = await lerCorpo(req);
    return responder(res, 200, { configuracoes: salvarConfiguracoes(corpo, usuario) });
  }

  if (rota === '/usuarios' && metodo === 'POST') {
    if (usuario.perfil !== 'admin') return responder(res, 403, { erro: 'Restrito ao administrador.' });
    return responder(res, 201, { usuario: criarUsuario(await lerCorpo(req), usuario) });
  }

  const senhaRota = rota.match(/^\/usuarios\/([\w-]+)\/senha$/);
  if (senhaRota && metodo === 'PUT') {
    const alvo = senhaRota[1];
    if (usuario.perfil !== 'admin' && usuario.id !== alvo) {
      return responder(res, 403, { erro: 'Só o administrador altera a senha de outro usuário.' });
    }
    const { senha } = await lerCorpo(req);
    return responder(res, 200, definirSenha(alvo, senha, usuario));
  }

  return responder(res, 404, { erro: 'Rota não encontrada.' });
}

function servirEstatico(req, res, url) {
  const base = resolve(config.estaticos);
  let caminho = normalize(decodeURIComponent(url.pathname));
  if (caminho === '/' || caminho.endsWith('/')) caminho = join(caminho, 'index.html');
  const arquivo = resolve(join(base, caminho));

  if (!arquivo.startsWith(base + sep) && arquivo !== base) {
    res.writeHead(403, cabecalhosBase()); return res.end('Acesso negado.');
  }
  if (!existsSync(arquivo) || statSync(arquivo).isDirectory()) {
    res.writeHead(404, cabecalhosBase({ 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('Não encontrado.');
  }
  const info = statSync(arquivo);
  const etag = `"${info.size}-${info.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, cabecalhosBase()); return res.end();
  }
  res.writeHead(200, cabecalhosBase({
    'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
    ETag: etag,
  }));
  return createReadStream(arquivo).pipe(res);
}

export async function iniciar() {
  await abrirBanco();
  const inicial = await prepararBase();

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api')) await api(req, res, url);
      else servirEstatico(req, res, url);
    } catch (e) {
      if (!res.headersSent) responder(res, e.status || 500, { erro: e.message || 'Erro interno.' });
      if (!e.status) console.error(e);
    }
  });

  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nA porta ${config.porta} já está em uso. Encerre o outro servidor `
        + 'ou inicie em outra porta, por exemplo: PORTA=3001 npm start\n');
      process.exit(1);
    }
    throw e;
  });

  servidor.listen(config.porta, config.host, () => {
    console.log(`Sentinela em http://localhost:${config.porta}`);
    if (inicial) {
      console.log('\n--- Acesso inicial do administrador ---');
      console.log(`E-mail: ${inicial.email}`);
      console.log(`Senha:  ${inicial.senha}${inicial.gerada ? '  (gerada agora — anote e troque no primeiro acesso)' : ''}`);
      console.log('---------------------------------------\n');
    }
  });
  return servidor;
}
