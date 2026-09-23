// Testes de ponta a ponta da API. Sobem um servidor isolado, em diretório de
// dados temporário, e exercitam autenticação, permissões, validações,
// auditoria e sincronização.
//
// Execução: node servidor/testes/testes.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..', '..');
const dados = mkdtempSync(join(tmpdir(), 'sentinela-teste-'));
const PORTA = 3311 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA_ADMIN = 'administrador123';

// Serviço de comunicações simulado: a API do CNJ recusa acesso de fora do
// Brasil, e teste não pode depender de rede externa.
const PORTA_CNJ = PORTA + 1;
const cnjFalso = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORTA_CNJ}`);
  ultimaConsultaCNJ = url.search;
  if (url.pathname.endsWith('/_search')) {
    ultimaConsultaDataJud = { caminho: url.pathname, autorizacao: req.headers.authorization, corpo: '' };
    let bruto = '';
    req.on('data', (p) => { bruto += p; });
    return req.on('end', () => {
      ultimaConsultaDataJud.corpo = bruto;
      if (url.pathname.includes('inexistente')) { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ hits: { hits: [{ _source: {
        numeroProcesso: '00001010820268170001', tribunal: 'TJPE',
        classe: { nome: 'Procedimento Comum' }, orgaoJulgador: { nome: '3ª Vara' },
        dataHoraUltimaAtualizacao: '2026-09-10T10:00:00.000Z',
        movimentos: [{ codigo: 26, nome: 'Distribuição', dataHora: '2026-01-15T09:00:00.000Z' }],
      } }] } }));
    });
  }
  if (url.pathname !== '/comunicacao') { res.writeHead(404); return res.end(); }
  if (falhaDoCNJ) {
    tentativasCNJ += 1;
    res.writeHead(falhaDoCNJ, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'detalhe vindo do CNJ' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ status: 'success', count: 1, items: [{
    id: 1, numero_processo: '00004018320268190001', data_disponibilizacao: '2026-09-10',
    siglaTribunal: 'TJPE', nomeOrgao: '3ª Vara Cível', texto: 'Intime-se no prazo de 15 dias.',
  }] }));
});
let ultimaConsultaCNJ = '';
let ultimaConsultaDataJud = null;
let falhaDoCNJ = 0;
let tentativasCNJ = 0;
cnjFalso.listen(PORTA_CNJ, '127.0.0.1');
process.on('exit', () => cnjFalso.close());

const opcoes = process.allowedNodeEnvironmentFlags.has('--experimental-sqlite')
  ? ['--experimental-sqlite'] : [];
const processo = spawn(process.execPath,
  [...opcoes, join(raiz, 'servidor', 'src', 'principal.js')], {
    env: { ...process.env, PORTA: String(PORTA), SENTINELA_DADOS: dados,
      SENTINELA_ADMIN_SENHA: SENHA_ADMIN, SENTINELA_ADMIN_EMAIL: 'admin@teste.adv.br',
      SENTINELA_DJEN_BASE: `http://127.0.0.1:${PORTA_CNJ}`,
      SENTINELA_DATAJUD_BASE: `http://127.0.0.1:${PORTA_CNJ}`,
      SENTINELA_DATAJUD_CHAVE: 'chave-do-servidor' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const linhasDoServidor = [];
processo.stderr.on('data', (d) => {
  linhasDoServidor.push(String(d));
  if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write(d);
});
processo.stdout.on('data', (d) => linhasDoServidor.push(String(d)));

const encerrar = () => { processo.kill(); rmSync(dados, { recursive: true, force: true }); };
process.on('exit', encerrar);

async function aguardarServidor() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/api/saude`)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Servidor não respondeu.');
}

/* Cliente com cookie por sessão, para simular navegadores diferentes. */
function criarCliente() {
  let cookie = '';
  return {
    async req(metodo, rota, corpo, { semCabecalho = false } = {}) {
      const cabecalhos = { 'Content-Type': 'application/json' };
      if (!semCabecalho) cabecalhos['X-Requisicao'] = 'sentinela';
      if (cookie) cabecalhos.Cookie = cookie;
      const r = await fetch(`${BASE}${rota}`, {
        method: metodo, headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const definido = r.headers.getSetCookie?.() || [];
      if (definido.length) cookie = definido.map((c) => c.split(';')[0]).join('; ');
      const tipo = r.headers.get('content-type') || '';
      return { status: r.status, dados: tipo.includes('json') ? await r.json() : await r.text() };
    },
  };
}

let passou = 0;
const teste = async (nome, fn) => {
  try { await fn(); passou += 1; console.log(`  ok  ${nome}`); }
  catch (e) { console.error(`FALHA  ${nome}\n       ${e.message}`); process.exitCode = 1; }
};

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

await aguardarServidor();
const admin = criarCliente();

console.log('\nDisponibilidade');
await teste('serviço responde', async () => {
  const r = await admin.req('GET', '/api/saude');
  assert.equal(r.status, 200);
  assert.equal(r.dados.ok, true);
});
await teste('aplicação é servida na raiz', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Jursistemy/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
await teste('não serve arquivo fora do diretório da aplicação', async () => {
  const r = await fetch(`${BASE}/../servidor/src/config.js`);
  assert.ok([403, 404].includes(r.status));
});

console.log('\nAutenticação');
await teste('recusa acesso sem sessão', async () => {
  assert.equal((await admin.req('GET', '/api/estado')).status, 401);
});
await teste('recusa senha incorreta', async () => {
  const r = await admin.req('POST', '/api/sessao', { email: 'admin@teste.adv.br', senha: 'errada' });
  assert.equal(r.status, 401);
});
await teste('recusa login sem o cabeçalho da aplicação', async () => {
  const r = await admin.req('POST', '/api/sessao',
    { email: 'admin@teste.adv.br', senha: SENHA_ADMIN }, { semCabecalho: true });
  assert.equal(r.status, 403);
});
await teste('aceita credenciais válidas e devolve o usuário sem dados sensíveis', async () => {
  const r = await admin.req('POST', '/api/sessao', { email: 'admin@teste.adv.br', senha: SENHA_ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.dados.usuario.perfil, 'admin');
  assert.equal(r.dados.usuario.senhaHash, undefined);
  assert.equal(r.dados.usuario.sal, undefined);
});
await teste('bloqueia após tentativas seguidas', async () => {
  const invasor = criarCliente();
  let ultimo = 0;
  for (let i = 0; i < 7; i += 1) {
    ultimo = (await invasor.req('POST', '/api/sessao',
      { email: 'admin@teste.adv.br', senha: `tentativa${i}` })).status;
  }
  assert.equal(ultimo, 429);
});

console.log('\nGravações');
const idCliente = uid('cli');
const idProcesso = uid('pro');
await teste('cria cliente e processo', async () => {
  const r = await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'clientes', dados: { id: idCliente, nome: 'Cliente Teste' },
      detalhe: 'Cliente cadastrado' },
    { op: 'inserir', colecao: 'processos', dados: { id: idProcesso, numeroCNJ: '08017018220188170001',
      clienteId: idCliente, status: 'ativo' } },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.dados.aplicadas.length, 2);
  assert.equal(r.dados.recusadas.length, 0);
  assert.ok(r.dados.aplicadas[0].registro.criadoEm);
});
await teste('recusa processo com número CNJ repetido', async () => {
  const r = await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'processos', dados: { id: uid('pro'), numeroCNJ: '0801701-82.2018.8.17.0001' } },
  ] });
  assert.equal(r.dados.aplicadas.length, 0);
  assert.equal(r.dados.recusadas[0].status, 409);
  assert.match(r.dados.recusadas[0].motivo, /já existe processo/i);
});
await teste('recusa prazo sem vencimento', async () => {
  const r = await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'prazos', dados: { id: uid('pra'), processoId: idProcesso } },
  ] });
  assert.match(r.dados.recusadas[0].motivo, /vencimento/i);
});
await teste('um item recusado não derruba o lote', async () => {
  const r = await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'tarefas', dados: { id: uid('tar'), titulo: 'Tarefa válida' } },
    { op: 'inserir', colecao: 'prazos', dados: { id: uid('pra'), processoId: idProcesso } },
  ] });
  assert.equal(r.dados.aplicadas.length, 1);
  assert.equal(r.dados.recusadas.length, 1);
});
await teste('ignora campos controlados pelo servidor', async () => {
  const id = uid('cli');
  await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'clientes',
      dados: { id, nome: 'Cliente', criadoPor: 'usuario-falso', excluidoEm: '2020-01-01T00:00:00Z' } },
  ] });
  const estado = (await admin.req('GET', '/api/estado')).dados;
  const gravado = estado.colecoes.clientes.find((c) => c.id === id);
  assert.notEqual(gravado.criadoPor, 'usuario-falso');
  assert.equal(gravado.excluidoEm, undefined);
});
await teste('exclusão é lógica e reversível', async () => {
  const id = uid('tar');
  await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'tarefas', dados: { id, titulo: 'Para excluir' } }] });
  await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'remover', colecao: 'tarefas', id, detalhe: 'teste' }] });
  let estado = (await admin.req('GET', '/api/estado')).dados;
  assert.ok(estado.colecoes.tarefas.find((t) => t.id === id).excluidoEm);
  await admin.req('POST', '/api/mutacoes', { mutacoes: [{ op: 'restaurar', colecao: 'tarefas', id }] });
  estado = (await admin.req('GET', '/api/estado')).dados;
  assert.equal(estado.colecoes.tarefas.find((t) => t.id === id).excluidoEm, undefined);
});
await teste('recusa gravação sem o cabeçalho da aplicação', async () => {
  const r = await admin.req('POST', '/api/mutacoes',
    { mutacoes: [{ op: 'inserir', colecao: 'clientes', dados: { id: uid('cli'), nome: 'X' } }] },
    { semCabecalho: true });
  assert.equal(r.status, 403);
});

console.log('\nAuditoria e sincronização');
await teste('toda gravação gera registro de auditoria com autor', async () => {
  const estado = (await admin.req('GET', '/api/estado')).dados;
  const evento = estado.auditoria.find((a) => a.registroId === idCliente);
  assert.ok(evento);
  assert.equal(evento.acao, 'criou');
  assert.equal(evento.usuarioNome, 'Administrador');
});
await teste('sincronização incremental traz apenas o que mudou', async () => {
  const marco = (await admin.req('GET', '/api/estado')).dados.servidor.agora;
  await new Promise((r) => setTimeout(r, 20));
  const id = uid('cli');
  await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'clientes', dados: { id, nome: 'Novo depois do marco' } }] });
  const delta = (await admin.req('GET', `/api/estado?desde=${encodeURIComponent(marco)}`)).dados;
  const ids = (delta.colecoes.clientes || []).map((c) => c.id);
  assert.ok(ids.includes(id));
  assert.equal(ids.includes(idCliente), false);
});

console.log('\nUsuários e permissões');
let idAssistente = null;
await teste('administrador cria usuários', async () => {
  const r = await admin.req('POST', '/api/usuarios', { nome: 'Assistente Teste',
    email: 'assistente@teste.adv.br', senha: 'assistente123', perfil: 'assistente' });
  assert.equal(r.status, 201);
  idAssistente = r.dados.usuario.id;
  assert.equal(r.dados.usuario.senhaHash, undefined);
});
await teste('recusa senha curta', async () => {
  const r = await admin.req('POST', '/api/usuarios', { nome: 'X', email: 'x@teste.adv.br', senha: '123' });
  assert.equal(r.status, 400);
});
await teste('recusa e-mail repetido', async () => {
  const r = await admin.req('POST', '/api/usuarios', { nome: 'Outro',
    email: 'assistente@teste.adv.br', senha: 'outrasenha123' });
  assert.equal(r.status, 400);
});

const assistente = criarCliente();
await teste('assistente entra no sistema', async () => {
  const r = await assistente.req('POST', '/api/sessao',
    { email: 'assistente@teste.adv.br', senha: 'assistente123' });
  assert.equal(r.status, 200);
});
await teste('assistente cria prazo, mas não exclui', async () => {
  const id = uid('pra');
  const criacao = await assistente.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'prazos',
      dados: { id, processoId: idProcesso, dataVencimento: '2026-10-10', tipo: 'manifestacao' } }] });
  assert.equal(criacao.dados.aplicadas.length, 1);
  const exclusao = await assistente.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'remover', colecao: 'prazos', id }] });
  assert.equal(exclusao.dados.recusadas[0].status, 403);
});
await teste('assistente não cria usuários', async () => {
  const r = await assistente.req('POST', '/api/usuarios', { nome: 'Invasor',
    email: 'invasor@teste.adv.br', senha: 'invasor12345' });
  assert.equal(r.status, 403);
});
await teste('assistente não altera senha de terceiro', async () => {
  const alvo = (await admin.req('GET', '/api/sessao')).dados.usuario.id;
  const r = await assistente.req('PUT', `/api/usuarios/${alvo}/senha`, { senha: 'novasenha123' });
  assert.equal(r.status, 403);
});
await teste('usuário troca a própria senha e reautentica', async () => {
  const troca = await assistente.req('PUT', `/api/usuarios/${idAssistente}/senha`, { senha: 'novasenha456' });
  assert.equal(troca.status, 200);
  const novo = criarCliente();
  assert.equal((await novo.req('POST', '/api/sessao',
    { email: 'assistente@teste.adv.br', senha: 'novasenha456' })).status, 200);
});
await teste('desativar usuário encerra o acesso', async () => {
  await admin.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'atualizar', colecao: 'usuarios', id: idAssistente, dados: { ativo: false } }] });
  const bloqueado = criarCliente();
  assert.equal((await bloqueado.req('POST', '/api/sessao',
    { email: 'assistente@teste.adv.br', senha: 'novasenha456' })).status, 401);
  assert.equal((await assistente.req('GET', '/api/estado')).status, 401);
});

console.log('\nConsulta pública de comunicações');
await teste('repassa a consulta por OAB e devolve o que o CNJ respondeu', async () => {
  const r = await admin.req('GET', '/api/djen/comunicacao?numeroOab=12345&ufOab=PE'
    + '&dataDisponibilizacaoInicio=2026-03-01&dataDisponibilizacaoFim=2026-09-15');
  assert.equal(r.status, 200);
  assert.equal(r.dados.count, 1);
  assert.equal(r.dados.items[0].siglaTribunal, 'TJPE');
});
await teste('encaminha apenas os parâmetros previstos', async () => {
  await admin.req('GET', '/api/djen/comunicacao?numeroOab=12345&ufOab=PE&segredo=xyz');
  assert.match(ultimaConsultaCNJ, /numeroOab=12345/);
  assert.match(ultimaConsultaCNJ, /ufOab=PE/);
  assert.ok(!ultimaConsultaCNJ.includes('segredo'));
});
await teste('recusa consulta sem OAB nem número de processo', async () => {
  const r = await admin.req('GET', '/api/djen/comunicacao?ufOab=PE');
  assert.equal(r.status, 400);
});

await teste('o status recusado pelo CNJ atravessa o repasse', async () => {
  falhaDoCNJ = 400; tentativasCNJ = 0;
  const r = await admin.req('GET', '/api/djen/comunicacao?numeroOab=12345&ufOab=PE');
  falhaDoCNJ = 0;
  assert.equal(r.status, 400);
  assert.equal(r.dados.origem, 400);
  assert.match(r.dados.detalhe, /detalhe vindo do CNJ/);
  // Recusa do pedido não se repete.
  assert.equal(tentativasCNJ, 1);
});
await teste('falha do serviço rende uma segunda tentativa', async () => {
  falhaDoCNJ = 500; tentativasCNJ = 0;
  const r = await admin.req('GET', '/api/djen/comunicacao?numeroOab=12345&ufOab=PE');
  falhaDoCNJ = 0;
  assert.equal(r.status, 502);
  assert.equal(r.dados.origem, 500);
  assert.equal(tentativasCNJ, 2);
});

console.log('\nConsulta de movimentos ao tribunal');
await teste('repassa a consulta ao DataJud com a chave do servidor', async () => {
  const r = await admin.req('POST', '/api/datajud',
    { indice: 'tjpe', numeroProcesso: '00001010820268170001' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.hits.hits[0]._source.tribunal, 'TJPE');
  assert.equal(ultimaConsultaDataJud.autorizacao, 'APIKey chave-do-servidor');
  assert.match(ultimaConsultaDataJud.caminho, /api_publica_tjpe/);
});
await teste('a chave enviada pelo cliente é descartada', async () => {
  await admin.req('POST', '/api/datajud',
    { indice: 'tjpe', numeroProcesso: '00001010820268170001', chave: 'forjada' });
  assert.equal(ultimaConsultaDataJud.autorizacao, 'APIKey chave-do-servidor');
  assert.ok(!ultimaConsultaDataJud.corpo.includes('forjada'));
});
await teste('recusa consulta sem número CNJ completo ou sem índice', async () => {
  assert.equal((await admin.req('POST', '/api/datajud',
    { indice: 'tjpe', numeroProcesso: '123' })).status, 400);
  assert.equal((await admin.req('POST', '/api/datajud',
    { numeroProcesso: '00001010820268170001' })).status, 400);
});
await teste('índice inexistente devolve 404 ao cliente', async () => {
  const r = await admin.req('POST', '/api/datajud',
    { indice: 'inexistente', numeroProcesso: '00001010820268170001' });
  assert.equal(r.status, 404);
});
await teste('o índice não pode escapar do caminho', async () => {
  await admin.req('POST', '/api/datajud',
    { indice: '../../etc/passwd', numeroProcesso: '00001010820268170001' });
  assert.ok(!ultimaConsultaDataJud.caminho.includes('..'));
});

console.log('\nAlteração de acesso e redefinição de senha');
await teste('usuário troca o próprio e-mail informando a senha atual', async () => {
  const eu = (await admin.req('GET', '/api/sessao')).dados.usuario;
  const r = await admin.req('PUT', `/api/usuarios/${eu.id}/acesso`,
    { email: 'admin2@teste.adv.br', senhaAtual: SENHA_ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.dados.usuario.email, 'admin2@teste.adv.br');
  // Volta ao endereço original para não afetar os testes seguintes.
  await admin.req('PUT', `/api/usuarios/${eu.id}/acesso`,
    { email: 'admin@teste.adv.br', senhaAtual: SENHA_ADMIN });
});
await teste('senha atual incorreta impede a alteração', async () => {
  const eu = (await admin.req('GET', '/api/sessao')).dados.usuario;
  const r = await admin.req('PUT', `/api/usuarios/${eu.id}/acesso`,
    { email: 'outro@teste.adv.br', senhaAtual: 'errada12345' });
  assert.equal(r.status, 401);
});
await teste('pedido de redefinição responde igual para e-mail existente e inexistente', async () => {
  const a = await admin.req('POST', '/api/recuperacao', { email: 'admin@teste.adv.br' });
  const b = await admin.req('POST', '/api/recuperacao', { email: 'ninguem@teste.adv.br' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.dados.mensagem, b.dados.mensagem);
  // Nenhuma resposta entrega o token nem diz se a conta existe.
  assert.ok(!JSON.stringify(a.dados).includes('token'));
});
await teste('token inválido é recusado', async () => {
  const r = await admin.req('POST', '/api/recuperacao/confirmar',
    { token: 'inexistente', senha: 'novaSenha123' });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /inválido|utilizado/i);
});
await teste('token do e-mail redefine a senha e vale uma única vez', async () => {
  // Sem provedor de e-mail, o servidor registra o link no console; o teste lê
  // o token da mesma origem que o administrador leria.
  // Conta própria para o teste: as anteriores podem ter sido desativadas, e
  // usuário inativo não recebe link de redefinição, por desenho.
  const criado = await admin.req('POST', '/api/usuarios', {
    nome: 'Paula Recuperação', email: 'paula@teste.adv.br',
    senha: 'senhaInicial123', perfil: 'advogado',
  });
  assert.equal(criado.status, 201);

  linhasDoServidor.length = 0;
  await admin.req('POST', '/api/recuperacao', { email: 'paula@teste.adv.br' });
  await new Promise((r) => setTimeout(r, 300));
  const token = (linhasDoServidor.join(' ').match(/redefinir\/([A-Za-z0-9]+)/) || [])[1];
  assert.ok(token, 'link de redefinição não foi registrado');

  const primeira = await admin.req('POST', '/api/recuperacao/confirmar',
    { token, senha: 'senhaRedefinida1' });
  assert.equal(primeira.status, 200);

  const repetida = await admin.req('POST', '/api/recuperacao/confirmar',
    { token, senha: 'outraSenha12345' });
  assert.equal(repetida.status, 400);

  const entrada = await criarCliente().req('POST', '/api/sessao',
    { email: 'paula@teste.adv.br', senha: 'senhaRedefinida1' });
  assert.equal(entrada.status, 200);
});

console.log('\nConfigurações e encerramento');
await teste('salva configurações do escritório', async () => {
  const r = await admin.req('PUT', '/api/configuracoes',
    { escritorio: { nome: 'Escritório Teste' }, alertasPadrao: [10, 5, 1, 0] });
  assert.equal(r.status, 200);
  assert.equal(r.dados.configuracoes.escritorio.nome, 'Escritório Teste');
  const estado = (await admin.req('GET', '/api/estado')).dados;
  assert.deepEqual(estado.configuracoes.alertasPadrao, [10, 5, 1, 0]);
});
await teste('encerrar sessão invalida o acesso', async () => {
  await admin.req('DELETE', '/api/sessao');
  assert.equal((await admin.req('GET', '/api/estado')).status, 401);
});

console.log('\nContas independentes');

// Duas contas criadas do zero, como duas pessoas se cadastrando no sistema.
const contaA = criarCliente();
const contaB = criarCliente();
let dadosA = null;
let dadosB = null;

await teste('qualquer pessoa cria a própria conta e já entra', async () => {
  const r = await contaA.req('POST', '/api/contas', {
    nome: 'Bruno Omena', email: 'bruno@escritorio-a.adv.br', senha: 'senhaforte123',
    escritorio: 'Omena Advocacia',
  });
  assert.equal(r.status, 201);
  assert.equal(r.dados.usuario.perfil, 'admin');
  assert.ok(r.dados.conta);
  dadosA = r.dados;
  // A sessão já vem aberta: o cadastro não obriga a entrar de novo.
  assert.equal((await contaA.req('GET', '/api/sessao')).status, 200);
});
await teste('a segunda conta nasce separada da primeira', async () => {
  const r = await contaB.req('POST', '/api/contas', {
    nome: 'Outro Advogado', email: 'outro@escritorio-b.adv.br', senha: 'senhaforte123',
    escritorio: 'Outro Escritório',
  });
  assert.equal(r.status, 201);
  dadosB = r.dados;
  assert.notEqual(dadosB.conta, dadosA.conta);
});
await teste('o mesmo e-mail não abre duas contas', async () => {
  const r = await criarCliente().req('POST', '/api/contas', {
    nome: 'Repetido', email: 'bruno@escritorio-a.adv.br', senha: 'senhaforte123',
  });
  assert.equal(r.status, 409);
  assert.match(r.dados.erro, /Já existe conta/);
});
await teste('senha curta é recusada no cadastro', async () => {
  const r = await criarCliente().req('POST', '/api/contas', {
    nome: 'Curto', email: 'curto@exemplo.br', senha: '123',
  });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /8 caracteres/);
});

await teste('cada conta só enxerga os próprios dados', async () => {
  const processoA = { id: uid('prc'), numeroCNJ: '00002020420268170001', clienteId: null,
    status: 'ativo', assunto: 'Processo da conta A' };
  const processoB = { id: uid('prc'), numeroCNJ: '00003030520268170001', clienteId: null,
    status: 'ativo', assunto: 'Processo da conta B' };
  assert.equal((await contaA.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'processos', dados: processoA }] })).dados.aplicadas.length, 1);
  assert.equal((await contaB.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'processos', dados: processoB }] })).dados.aplicadas.length, 1);

  const deA = (await contaA.req('GET', '/api/estado')).dados.colecoes.processos;
  const deB = (await contaB.req('GET', '/api/estado')).dados.colecoes.processos;
  assert.deepEqual(deA.map((p) => p.assunto), ['Processo da conta A']);
  assert.deepEqual(deB.map((p) => p.assunto), ['Processo da conta B']);
});
await teste('o número CNJ de uma conta não bloqueia o da outra', async () => {
  // Duplicidade é impedimento dentro da conta, não entre escritórios distintos.
  const mesmo = { id: uid('prc'), numeroCNJ: '00002020420268170001', clienteId: null,
    status: 'ativo', assunto: 'Mesmo número, outro escritório' };
  const r = await contaB.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'processos', dados: mesmo }] });
  assert.equal(r.dados.aplicadas.length, 1, JSON.stringify(r.dados.recusadas));

  const repetido = { id: uid('prc'), numeroCNJ: '00002020420268170001', clienteId: null,
    status: 'ativo', assunto: 'Repetido na mesma conta' };
  const r2 = await contaA.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'inserir', colecao: 'processos', dados: repetido }] });
  assert.equal(r2.dados.recusadas.length, 1);
  assert.equal(r2.dados.recusadas[0].status, 409);
});
await teste('registro de uma conta não é alcançável pelo id a partir de outra', async () => {
  const daA = (await contaA.req('GET', '/api/estado')).dados.colecoes.processos[0];
  const r = await contaB.req('POST', '/api/mutacoes', { mutacoes: [
    { op: 'atualizar', colecao: 'processos', id: daA.id, dados: { assunto: 'invadido' } }] });
  assert.equal(r.dados.recusadas.length, 1);
  assert.equal(r.dados.recusadas[0].status, 404);
  const conferir = (await contaA.req('GET', '/api/estado')).dados.colecoes.processos
    .find((p) => p.id === daA.id);
  assert.equal(conferir.assunto, 'Processo da conta A');
});
await teste('configurações e auditoria também não se misturam', async () => {
  await contaA.req('PUT', '/api/configuracoes', { escritorio: { nome: 'Omena Advocacia' } });
  const cfgA = (await contaA.req('GET', '/api/estado')).dados.configuracoes;
  const cfgB = (await contaB.req('GET', '/api/estado')).dados.configuracoes;
  assert.equal(cfgA.escritorio.nome, 'Omena Advocacia');
  assert.notEqual(cfgB.escritorio.nome, 'Omena Advocacia');

  const audB = (await contaB.req('GET', '/api/estado')).dados.auditoria;
  assert.ok(audB.every((a) => a.usuarioNome !== 'Bruno Omena'));
});

await teste('a conta entra de outro dispositivo com o mesmo e-mail e senha', async () => {
  // Outro navegador, sem cookie algum: é o caso de acessar de outro lugar.
  const outroDispositivo = criarCliente();
  const r = await outroDispositivo.req('POST', '/api/sessao', {
    email: 'bruno@escritorio-a.adv.br', senha: 'senhaforte123',
  });
  assert.equal(r.status, 200);
  assert.equal(r.dados.usuario.email, 'bruno@escritorio-a.adv.br');
  const estado = (await outroDispositivo.req('GET', '/api/estado')).dados;
  assert.ok(estado.colecoes.processos.some((p) => p.assunto === 'Processo da conta A'));
});
await teste('usuário criado dentro da conta pertence a ela', async () => {
  const r = await contaA.req('POST', '/api/usuarios', {
    nome: 'Assistente', email: 'assistente@escritorio-a.adv.br', senha: 'senhaforte123',
    perfil: 'assistente',
  });
  assert.equal(r.status, 201);
  assert.equal(r.dados.usuario.contaId, dadosA.conta);

  const dele = criarCliente();
  await dele.req('POST', '/api/sessao', {
    email: 'assistente@escritorio-a.adv.br', senha: 'senhaforte123',
  });
  const estado = (await dele.req('GET', '/api/estado')).dados;
  assert.ok(estado.colecoes.processos.some((p) => p.assunto === 'Processo da conta A'));
});
await teste('a redefinição por e-mail encontra a conta certa', async () => {
  const r = await criarCliente().req('POST', '/api/recuperacao',
    { email: 'outro@escritorio-b.adv.br' });
  assert.equal(r.status, 200);
  assert.match(r.dados.mensagem, /instruções de redefinição/i);
});

console.log(`\n${passou} verificações concluídas.`);
encerrar();
process.exit(process.exitCode || 0);
