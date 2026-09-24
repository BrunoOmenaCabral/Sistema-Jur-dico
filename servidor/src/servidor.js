// Servidor HTTP sem dependências: serve a aplicação e expõe a API.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { config } from './config.js';
import { enviar as enviarEmail, disponivel as emailDisponivel } from './email.js';
import { abrirBanco, banco } from './banco.js';
import {
  criarToken, lerToken, cookieDeSessao, cookieDeSaida, lerCookies, NOME_COOKIE,
  registrarFalha, limparFalhas, bloqueado,
} from './sessao.js';
import {
  autenticar, aplicarMutacoes, estadoCompleto, estadoDesde, salvarConfiguracoes,
  criarUsuario, definirSenha, usuarioPorId, publicarUsuario, prepararBase, ErroDeUso,
  criarConta,
  alterarAcesso, solicitarRecuperacao, redefinirComToken,
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

const usuarioDaRequisicao = async (req) => {
  const carga = lerToken(lerCookies(req.headers.cookie)[NOME_COOKIE]);
  if (!carga?.contaId) return null;
  const u = await usuarioPorId(carga.contaId, carga.usuarioId);
  return u && u.ativo !== false && !u.excluidoEm ? u : null;
};

/* Cabeçalho próprio em toda gravação: bloqueia requisição forjada de outro site,
   que não consegue definir cabeçalhos personalizados sem autorização de origem. */
const origemConfiavel = (req) => req.headers['x-requisicao'] === 'sentinela';

async function api(req, res, url) {
  const rota = url.pathname.replace(/^\/api/, '') || '/';
  const metodo = req.method;

  // Diagnóstico da instalação. Diz, sem expor segredo algum, se cada peça da
  // hospedagem está no lugar: é o que permite conferir o resultado de cada
  // ajuste abrindo um endereço, sem acesso ao terminal do servidor.
  if (rota === '/saude') {
    const persistencia = banco.tipo;
    const gerenciado = persistencia === 'turso';
    return responder(res, 200, {
      ok: true,
      servico: 'sentinela',
      versao: 1,
      persistencia,
      // Em hospedagem sem disco, só o banco gerenciado preserva os dados.
      dadosPreservados: gerenciado,
      email: emailDisponivel(),
      enderecoPublico: Boolean(config.enderecoPublico),
      segredoFixo: Boolean(process.env.SENTINELA_SEGREDO),
      // Quais credenciais do banco chegaram ao processo. Distinguir as duas
      // poupa adivinhação: um valor em branco no painel da hospedagem é
      // indistinguível de um valor correto quando se olha só a tela.
      banco: {
        url: Boolean(config.turso.url),
        token: Boolean(config.turso.token),
        tamanhoToken: config.turso.token.length,
      },
      pendencias: [
        gerenciado ? null : `Banco gerenciado ausente: ${
          !config.turso.url && !config.turso.token ? 'TURSO_DATABASE_URL e TURSO_AUTH_TOKEN não chegaram ao servidor'
            : !config.turso.url ? 'TURSO_DATABASE_URL está vazia'
              : 'TURSO_AUTH_TOKEN está vazio'
        }. Sem ele, os dados se perdem quando a hospedagem recria o serviço.`,
        emailDisponivel() ? null : 'Defina SENTINELA_EMAIL_ENDPOINT, SENTINELA_EMAIL_CHAVE e '
          + 'SENTINELA_EMAIL_REMETENTE para o link de redefinição chegar ao e-mail.',
        config.enderecoPublico ? null : 'Defina SENTINELA_ENDERECO com o endereço público, '
          + 'usado no link de redefinição de senha.',
        process.env.SENTINELA_SEGREDO ? null : 'Defina SENTINELA_SEGREDO: sem ele, cada '
          + 'reinício do serviço derruba as sessões abertas.',
      ].filter(Boolean),
    });
  }

  // Cadastro que qualquer pessoa faz sozinha: conta nova, com o seu primeiro
  // acesso. É o que permite entrar de qualquer lugar, sem depender do navegador
  // em que a conta foi criada.
  if (rota === '/contas' && metodo === 'POST') {
    if (!origemConfiavel(req)) return responder(res, 403, { erro: 'Requisição não autorizada.' });
    const chave = `conta|${req.socket.remoteAddress}`;
    const espera = bloqueado(chave);
    if (espera) return responder(res, 429, { erro: `Aguarde ${espera} segundos para novo cadastro.` });
    registrarFalha(chave);

    try {
      const { nome, email, senha, escritorio } = await lerCorpo(req);
      const { contaId, usuario } = await criarConta({ nome, email, senha, escritorio });
      return responder(res, 201, { usuario, conta: contaId },
        { 'Set-Cookie': cookieDeSessao(criarToken(usuario.id, contaId)) });
    } catch (e) {
      return responder(res, e.status || 400, { erro: e.message });
    }
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
      const usuario = await autenticar(email, senha);
      limparFalhas(chave);
      return responder(res, 200, { usuario },
        { 'Set-Cookie': cookieDeSessao(criarToken(usuario.id, usuario.contaId)) });
    } catch (e) {
      registrarFalha(chave);
      return responder(res, e.status || 401, { erro: e.message });
    }
  }

  if (rota === '/sessao' && metodo === 'DELETE') {
    return responder(res, 200, { ok: true }, { 'Set-Cookie': cookieDeSaida() });
  }

  // Redefinição de senha: pública por natureza, já que quem a pede não
  // consegue entrar. O limite por endereço evita que vire ferramenta de sondagem.
  if (rota === '/recuperacao' && metodo === 'POST') {
    if (!origemConfiavel(req)) return responder(res, 403, { erro: 'Requisição não autorizada.' });
    const { email } = await lerCorpo(req);
    const chave = `recuperacao|${req.socket.remoteAddress}`;
    const espera = bloqueado(chave);
    if (espera) return responder(res, 429, { erro: `Aguarde ${espera} segundos para novo pedido.` });
    registrarFalha(chave);

    const pedido = await solicitarRecuperacao(email);
    // A resposta é a mesma exista ou não a conta, para não revelar quem tem acesso.
    const generica = { ok: true, mensagem: 'Se houver conta com este e-mail, as instruções de '
      + 'redefinição foram enviadas para ele.' };
    if (!pedido.token) return responder(res, 200, generica);

    const base = config.enderecoPublico || `http://${req.headers.host || 'localhost'}`;
    const link = `${base}/#/redefinir/${pedido.token}`;
    const envio = await enviarEmail({
      para: pedido.usuario.email,
      assunto: 'Redefinição de senha',
      texto: `Você pediu para redefinir a senha de acesso ao sistema.\n\n${link}\n\n`
        + `O link vale por ${config.minutosRecuperacao} minutos e só pode ser usado uma vez. `
        + 'Se não foi você quem pediu, ignore esta mensagem: nada muda sem que o link seja aberto.',
    });
    if (!envio.enviado) {
      // Sem provedor de e-mail, o administrador recebe o link pelo registro do
      // servidor. É o que evita deixar alguém trancado do lado de fora.
      console.warn(`[recuperacao] e-mail não enviado (${envio.motivo}). Link para `
        + `${pedido.usuario.email}: ${link}`);
    }
    return responder(res, 200, { ...generica, emailConfigurado: emailDisponivel() });
  }

  if (rota === '/recuperacao/confirmar' && metodo === 'POST') {
    if (!origemConfiavel(req)) return responder(res, 403, { erro: 'Requisição não autorizada.' });
    const { token, senha } = await lerCorpo(req);
    try {
      return responder(res, 200, await redefinirComToken(token, senha));
    } catch (e) {
      return responder(res, e.status || 400, { erro: e.message });
    }
  }

  const usuario = await usuarioDaRequisicao(req);

  if (rota === '/sessao' && metodo === 'GET') {
    return usuario
      ? responder(res, 200, { usuario: publicarUsuario(usuario) })
      : responder(res, 401, { erro: 'Sessão não encontrada.' });
  }

  if (!usuario) return responder(res, 401, { erro: 'Autentique-se para continuar.' });
  if (metodo !== 'GET' && !origemConfiavel(req)) {
    return responder(res, 403, { erro: 'Requisição não autorizada.' });
  }

  // Repasse da consulta pública de comunicações do CNJ.
  //
  // O navegador não consegue chamar o serviço do CNJ a partir de outra origem,
  // e o serviço recusa acesso de fora do Brasil. Pelo servidor do escritório a
  // chamada sai do mesmo lugar em que ele está hospedado e sem o obstáculo da
  // política de origem. Nada é gravado aqui: o repasse é somente de leitura.
  if ((rota === '/djen' || rota === '/djen/comunicacao') && metodo === 'GET') {
    const permitidos = ['numeroOab', 'ufOab', 'nomeAdvogado', 'nomeParte', 'numeroProcesso',
      'dataDisponibilizacaoInicio', 'dataDisponibilizacaoFim', 'pagina', 'itensPorPagina'];
    const parametros = new URLSearchParams();
    for (const chave of permitidos) {
      const valor = url.searchParams.get(chave);
      if (valor) parametros.set(chave, valor.slice(0, 64));
    }
    if (!parametros.get('numeroOab') && !parametros.get('numeroProcesso')) {
      return responder(res, 400, { erro: 'Informe a OAB ou o número do processo.' });
    }

    // Instabilidade momentânea é comum neste serviço, e uma segunda tentativa
    // resolve boa parte dos casos. Recusa do pedido não se repete.
    let ultima = { status: 504, erro: 'Consulta ao CNJ não iniciada.' };
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      if (tentativa) await new Promise((r) => setTimeout(r, 700));
      try {
        const externa = await fetch(`${config.djenBase}/comunicacao?${parametros}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(config.tempoLimiteConsultaMs),
        });
        const texto = await externa.text();
        if (externa.ok) {
          try { return responder(res, 200, JSON.parse(texto)); }
          catch { return responder(res, 502, { erro: 'O CNJ devolveu resposta ilegível.' }); }
        }
        ultima = { status: externa.status, origem: externa.status,
          erro: `O serviço do CNJ respondeu ${externa.status}.`, detalhe: texto.slice(0, 400) };
        if (externa.status < 500) break;
      } catch (e) {
        ultima = { status: 504, erro: `Consulta ao CNJ não concluída: ${e.message}` };
      }
    }
    const { status, ...corpo } = ultima;
    return responder(res, status >= 400 && status < 500 ? status : 502, corpo);
  }

  // Repasse da consulta de movimentos ao DataJud.
  //
  // O serviço do CNJ não autoriza chamada de outra origem, então o navegador
  // sozinho não alcança. A chave usada é a do servidor, nunca a que o cliente
  // mandar, e só o índice e o número do processo atravessam.
  // Mesmo contrato da ponte da hospedagem: índice e número, nada mais.
  if (rota === '/datajud' && metodo === 'POST') {
    const corpo = await lerCorpo(req);
    const indice = String(corpo?.indice || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const numero = String(corpo?.numeroProcesso || '').replace(/\D/g, '');
    if (!indice) return responder(res, 400, { erro: 'Informe o índice do tribunal.' });
    if (numero.length !== 20) {
      return responder(res, 400, { erro: 'Informe o número CNJ com 20 dígitos.' });
    }
    try {
      const externa = await fetch(`${config.datajudBase}/api_publica_${indice}/_search`, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${config.datajudChave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: { match: { numeroProcesso: numero } }, size: 10 }),
        signal: AbortSignal.timeout(config.tempoLimiteConsultaMs),
      });
      if (!externa.ok) {
        return responder(res, externa.status === 404 ? 404 : 502,
          { erro: `O DataJud respondeu ${externa.status}.` });
      }
      return responder(res, 200, await externa.json());
    } catch (e) {
      return responder(res, 504, { erro: `Consulta ao DataJud não concluída: ${e.message}` });
    }
  }

  if (rota === '/estado' && metodo === 'GET') {
    const desde = url.searchParams.get('desde');
    return responder(res, 200, desde
      ? await estadoDesde(usuario.contaId, desde) : await estadoCompleto(usuario.contaId));
  }

  if (rota === '/mutacoes' && metodo === 'POST') {
    const { mutacoes } = await lerCorpo(req);
    if (!Array.isArray(mutacoes)) return responder(res, 400, { erro: 'Envie a lista de mutações.' });
    if (mutacoes.length > 500) return responder(res, 400, { erro: 'Lote acima de 500 operações.' });
    return responder(res, 200, await aplicarMutacoes(mutacoes, usuario));
  }

  if (rota === '/configuracoes' && metodo === 'PUT') {
    const corpo = await lerCorpo(req);
    return responder(res, 200, { configuracoes: await salvarConfiguracoes(corpo, usuario) });
  }

  if (rota === '/usuarios' && metodo === 'POST') {
    if (usuario.perfil !== 'admin') return responder(res, 403, { erro: 'Restrito ao administrador.' });
    return responder(res, 201, { usuario: await criarUsuario(await lerCorpo(req), usuario) });
  }

  const acessoRota = rota.match(/^\/usuarios\/([\w-]+)\/acesso$/);
  if (acessoRota && metodo === 'PUT') {
    try {
      return responder(res, 200, await alterarAcesso(acessoRota[1], await lerCorpo(req), usuario));
    } catch (e) {
      return responder(res, e.status || 400, { erro: e.message });
    }
  }

  const senhaRota = rota.match(/^\/usuarios\/([\w-]+)\/senha$/);
  if (senhaRota && metodo === 'PUT') {
    const alvo = senhaRota[1];
    if (usuario.perfil !== 'admin' && usuario.id !== alvo) {
      return responder(res, 403, { erro: 'Só o administrador altera a senha de outro usuário.' });
    }
    const { senha } = await lerCorpo(req);
    return responder(res, 200, await definirSenha(usuario.contaId, alvo, senha, usuario));
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
