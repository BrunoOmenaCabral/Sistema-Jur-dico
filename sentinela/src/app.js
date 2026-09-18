// Ponto de entrada da aplicação.

import {
  db, sessao, ativarModoServidor, sincronizarCompleto, sincronizarIncremental,
  enviarFila, modoAtual,
} from './core/store.js';
import { api } from './core/api.js';
import { detectarPonte } from './core/ponte.js';
import { usuarioAtual, pode } from './core/auth.js';
import { sincronizarNotificacoes, revisarVinculos } from './core/dominio.js';
import { publicacoes as servicoPublicacoes } from './core/integracoes.js';
import { rondaDevida, executarRonda, avisarNoDispositivo } from './core/rondas.js';
import { interpretarPublicacao } from './core/ia.js';
import { registrar, iniciarRoteador, aoTrocarRota, renderizar } from './ui/roteador.js';
import { montarCasca, atualizarNavegacao, atualizarContadorNotificacoes } from './ui/casca.js';
import { telaLogin, telaRedefinicao } from './views/login.js';
import { abrirConsultaProcessual } from './views/primeiro-acesso.js';
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
import { relatorioProcessualView } from './views/relatorio-processual.js';
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
  ['relatorio-processual', relatorioProcessualView, 'relatorios:ver'],
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

  // Link de redefinição recebido por e-mail: quem chega por ele não tem como
  // entrar, então a tela vem antes de qualquer exigência de sessão.
  const redefinicao = location.hash.match(/^#\/redefinir\/([A-Za-z0-9]+)$/);
  if (redefinicao) {
    if (await api.disponivel()) ativarModoServidor();
    telaRedefinicao(redefinicao[1], () => {
      aviso('Senha redefinida. Entre com a nova senha.', 'ok', 6000);
      telaLogin(abrirAplicacao);
    });
    return;
  }

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

  // Sem servidor próprio, ainda pode haver repasse na hospedagem. Sabendo disso
  // antes das telas de consulta, elas deixam de tentar a chamada que o
  // navegador bloquearia.
  await detectarPonte();

  // Nenhuma base de demonstração é criada automaticamente: quem cria a conta
  // recebe o sistema vazio e faz os próprios cadastros. A demonstração
  // continua disponível, sob solicitação, em Configurações.
  if (!sessao.obter() || !usuarioAtual()) {
    telaLogin(abrirAplicacao);
    return;
  }
  abrirAplicacao();
}

function abrirAplicacao({ novaConta = false } = {}) {
  const alvo = montarCasca();
  registrarTelas();
  aoTrocarRota(() => { atualizarNavegacao(); atualizarContadorNotificacoes(); });
  iniciarRoteador(alvo);

  // Conta recém-criada entra no sistema vazio: o assistente oferece trazer os
  // processos ativos antes de qualquer cadastro manual.
  if (novaConta) abrirConsultaProcessual(() => renderizar(alvo), { boasVindas: true });

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

  // Publicação que chegou antes do cadastro do processo encontra o vínculo
  // aqui, sem depender de o usuário lembrar de pedir.
  const vinculos = revisarVinculos({ reinterpretar: interpretarPublicacao });
  if (vinculos.vinculadas) {
    aviso(`${vinculos.vinculadas} publicação(ões) vinculada(s) a processo cadastrado depois.`,
      'ok', 6000);
  }

  const novas = sincronizarNotificacoes();
  atualizarContadorNotificacoes();
  if (novas) aviso(`${novas} novo(s) alerta(s) na central de notificações.`, 'atencao', 6000);

  if (servicoPublicacoes.devidaHoje()) {
    const r = await servicoPublicacoes.consultar();
    if (r.importadas) aviso(r.mensagem, 'ok', 6000);
  }

  ronda();
  // Sistema aberto o dia todo atravessa as três janelas sem ser recarregado:
  // a verificação periódica é o que faz a ronda da tarde e a da noite correrem.
  setInterval(ronda, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ronda(); });
}

let rondaEmCurso = false;

/**
 * Ronda de atualização dos processos, se a desta janela ainda não correu.
 *
 * Roda em segundo plano: quem está trabalhando não espera pela consulta. O que
 * mudou aparece na central de notificações e, havendo autorização, no aviso do
 * próprio sistema operacional.
 */
async function ronda() {
  if (rondaEmCurso) return;
  const { devida } = rondaDevida();
  if (!devida) return;

  rondaEmCurso = true;
  try {
    const r = await executarRonda();
    atualizarContadorNotificacoes();
    if (r.novidades.length) {
      avisarNoDispositivo(r.novidades);
      aviso(`${r.novidades.length} processo(s) com movimentação nova. `
        + 'Veja na central de notificações.', 'ok', 8000);
    }
  } catch (e) {
    console.error('Ronda de atualização falhou', e);
  } finally {
    rondaEmCurso = false;
  }
}

iniciar().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div class="aviso aviso--alerta" style="margin:2rem">
    Falha ao iniciar o sistema: ${e.message}</div>`;
});
