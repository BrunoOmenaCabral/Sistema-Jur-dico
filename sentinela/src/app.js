// Ponto de entrada da aplicação.

import {
  db, sessao, ativarModoServidor, sincronizarCompleto, sincronizarIncremental,
  enviarFila, modoAtual,
} from './core/store.js';
import { api } from './core/api.js';
import { semear } from './core/seed.js';
import { usuarioAtual, pode } from './core/auth.js';
import { sincronizarNotificacoes } from './core/dominio.js';
import { publicacoes as servicoPublicacoes } from './core/integracoes.js';
import { registrar, iniciarRoteador, aoTrocarRota, renderizar } from './ui/roteador.js';
import { montarCasca, atualizarNavegacao, atualizarContadorNotificacoes } from './ui/casca.js';
import { telaLogin } from './views/login.js';
import { aviso } from './ui/ui.js';

import { dashboard } from './views/dashboard.js';
import { agenda } from './views/agenda.js';
import { prazos } from './views/prazos.js';
import { processos } from './views/processos.js';
import { clientes } from './views/clientes.js';
import { publicacoes } from './views/publicacoes.js';
import { tarefas } from './views/tarefas.js';
import { audiencias } from './views/audiencias.js';
import { documentos } from './views/documentos.js';
import { relatorios } from './views/relatorios.js';
import { financeiro } from './views/financeiro.js';
import { comunicacoes } from './views/comunicacoes.js';
import { ia } from './views/ia.js';
import { usuarios } from './views/usuarios.js';
import { configuracoes } from './views/configuracoes.js';

const TELAS = [
  ['dashboard', dashboard, 'dashboard:ver'],
  ['agenda', agenda, 'agenda:ver'],
  ['prazos', prazos, 'prazos:ver'],
  ['processos', processos, 'processos:ver'],
  ['clientes', clientes, 'clientes:ver'],
  ['publicacoes', publicacoes, 'publicacoes:ver'],
  ['tarefas', tarefas, 'tarefas:ver'],
  ['audiencias', audiencias, 'audiencias:ver'],
  ['documentos', documentos, 'documentos:ver'],
  ['relatorios', relatorios, 'relatorios:ver'],
  ['financeiro', financeiro, 'financeiro:ver'],
  ['comunicacoes', comunicacoes, 'comunicacoes:ver'],
  ['ia', ia, 'ia:usar'],
  ['usuarios', usuarios, 'usuarios:ver'],
  ['configuracoes', configuracoes, 'configuracoes:ver'],
];

function aplicarTema() {
  const salvo = localStorage.getItem('sentinela.tema');
  document.documentElement.dataset.tema = salvo
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
}

function registrarTelas() {
  for (const [nome, render, permissao] of TELAS) {
    registrar(nome, (ctx) => (pode(permissao)
      ? render(ctx)
      : '<div class="aviso aviso--alerta">Você não tem permissão para acessar este módulo.</div>'));
  }
  registrar('nao-encontrada', () => '<div class="vazio"><span class="ico">🧭</span>Tela não encontrada.</div>');
}

async function iniciar() {
  aplicarTema();

  // Havendo backend nesta origem, ele é a fonte dos dados. Sem backend, o
  // sistema segue funcionando com a base do próprio navegador.
  if (await api.disponivel()) {
    ativarModoServidor();
    try {
      const { usuario } = await api.sessao();
      sessao.definir({ usuarioId: usuario.id, nome: usuario.nome, perfil: usuario.perfil,
        em: new Date().toISOString() });
      await sincronizarCompleto();
      abrirAplicacao();
    } catch {
      sessao.limpar();
      telaLogin(async () => { await sincronizarCompleto(); abrirAplicacao(); });
    }
    return;
  }

  await semear();
  if (!sessao.obter() || !usuarioAtual()) {
    telaLogin(abrirAplicacao);
    return;
  }
  abrirAplicacao();
}

function abrirAplicacao() {
  const alvo = montarCasca();
  registrarTelas();
  aoTrocarRota(() => { atualizarNavegacao(); atualizarContadorNotificacoes(); });
  iniciarRoteador(alvo);

  rotinaDiaria();
  // Reavalia alertas periodicamente enquanto a aba permanece aberta.
  setInterval(() => { sincronizarNotificacoes(); atualizarContadorNotificacoes(); }, 5 * 60 * 1000);

  if (modoAtual() === 'servidor') ligarSincronizacao();
}

/** Mantém a cópia local alinhada ao servidor e reenvia o que ficou pendente. */
function ligarSincronizacao() {
  const puxar = async () => {
    const { novidades } = await sincronizarIncremental();
    if (novidades) { atualizarNavegacao(); atualizarContadorNotificacoes(); }
  };
  setInterval(puxar, 30 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) puxar(); });
  window.addEventListener('online', () => { enviarFila().then(puxar); });
  window.addEventListener('beforeunload', () => { enviarFila(); });
}

async function rotinaDiaria() {
  db.backupAutomatico();
  const novas = sincronizarNotificacoes();
  atualizarContadorNotificacoes();
  if (novas) aviso(`${novas} novo(s) alerta(s) na central de notificações.`, 'atencao', 6000);

  if (servicoPublicacoes.devidaHoje()) {
    const r = await servicoPublicacoes.consultar();
    if (r.importadas) aviso(r.mensagem, 'ok', 6000);
  }
}

iniciar().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div class="aviso aviso--alerta" style="margin:2rem">
    Falha ao iniciar o sistema: ${e.message}</div>`;
});
