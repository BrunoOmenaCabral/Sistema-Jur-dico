// Testes de ponta a ponta da API. Sobem um servidor isolado, em diretório de
// dados temporário, e exercitam autenticação, permissões, validações,
// auditoria e sincronização.
//
// Execução: node servidor/testes/testes.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

const opcoes = process.allowedNodeEnvironmentFlags.has('--experimental-sqlite')
  ? ['--experimental-sqlite'] : [];
const processo = spawn(process.execPath,
  [...opcoes, join(raiz, 'servidor', 'src', 'principal.js')], {
    env: { ...process.env, PORTA: String(PORTA), SENTINELA_DADOS: dados,
      SENTINELA_ADMIN_SENHA: SENHA_ADMIN, SENTINELA_ADMIN_EMAIL: 'admin@teste.adv.br' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
processo.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write(d); });

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
  assert.match(await r.text(), /Sentinela/);
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

console.log(`\n${passou} verificações concluídas.`);
encerrar();
process.exit(process.exitCode || 0);
