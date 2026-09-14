// Estrutura da aplicação: navegação lateral, barra superior com busca global,
// central de notificações e navegação inferior no celular.

import { h, qs, qsa, esc, aviso, modal, delegar } from './ui.js';
import { db, aoMudar, aoSincronizar, modoAtual, enviarFila } from '../core/store.js';
import { usuarioAtual, sair, pode } from '../core/auth.js';
import { buscaGlobal, indicadores, sincronizarNotificacoes } from '../core/dominio.js';
import { debounce, fmtDataHora } from '../core/util.js';
import { ir, rotaAtual } from './roteador.js';

export const MENU = [
  { grupo: 'Operação', itens: [
    { rota: 'dashboard', rotulo: 'Dashboard', ico: '◧', permissao: 'dashboard:ver' },
    { rota: 'agenda', rotulo: 'Agenda', ico: '▦', permissao: 'agenda:ver' },
    { rota: 'prazos', rotulo: 'Prazos', ico: '⏱', permissao: 'prazos:ver', contador: 'prazosAbertos' },
    { rota: 'publicacoes', rotulo: 'Publicações', ico: '📰', permissao: 'publicacoes:ver', contador: 'publicacoesPendentes' },
    { rota: 'tarefas', rotulo: 'Tarefas', ico: '✓', permissao: 'tarefas:ver' },
    { rota: 'audiencias', rotulo: 'Audiências', ico: '⚖', permissao: 'audiencias:ver' },
  ] },
  { grupo: 'Cadastros', itens: [
    { rota: 'processos', rotulo: 'Processos', ico: '📁', permissao: 'processos:ver' },
    { rota: 'clientes', rotulo: 'Clientes', ico: '👤', permissao: 'clientes:ver' },
    { rota: 'documentos', rotulo: 'Documentos', ico: '📄', permissao: 'documentos:ver' },
  ] },
  { grupo: 'Gestão', itens: [
    { rota: 'relatorios', rotulo: 'Relatórios', ico: '📊', permissao: 'relatorios:ver' },
    { rota: 'financeiro', rotulo: 'Financeiro', ico: '💰', permissao: 'financeiro:ver' },
    { rota: 'comunicacoes', rotulo: 'Comunicações', ico: '💬', permissao: 'comunicacoes:ver' },
    { rota: 'ia', rotulo: 'Assistente IA', ico: '✨', permissao: 'ia:usar' },
  ] },
  { grupo: 'Sistema', itens: [
    { rota: 'usuarios', rotulo: 'Usuários', ico: '🛡', permissao: 'usuarios:ver' },
    { rota: 'configuracoes', rotulo: 'Configurações', ico: '⚙', permissao: 'configuracoes:ver' },
  ] },
];

const MENU_MOBILE = [
  { rota: 'dashboard', rotulo: 'Hoje', ico: '◧' },
  { rota: 'agenda', rotulo: 'Agenda', ico: '▦' },
  { rota: 'prazos', rotulo: 'Prazos', ico: '⏱' },
  { rota: 'processos', rotulo: 'Processos', ico: '📁' },
  { rota: 'clientes', rotulo: 'Clientes', ico: '👤' },
];

export function montarCasca() {
  const app = h(`
    <div class="app">
      <aside class="lateral" id="lateral">
        <div class="lateral__marca">
          <span style="font-size:1.3rem">⚖️</span>
          <div>SENTINELA<small>GESTÃO JURÍDICA</small></div>
        </div>
        <nav class="lateral__nav" id="nav"></nav>
        <div class="lateral__rodape" id="rodape-lateral"></div>
      </aside>
      <div class="principal">
        <header class="topo">
          <button class="btn-menu" id="btn-menu" aria-label="Menu">☰</button>
          <div class="busca">
            <span class="lupa">🔎</span>
            <input id="busca" type="search" placeholder="Buscar processo, cliente, CPF/CNPJ, prazo…"
              autocomplete="off" aria-label="Busca global">
            <div class="busca__resultados oculto" id="busca-resultados"></div>
          </div>
          <span id="sincronia" class="mini mudo" title="Situação da sincronização"></span>
          <button class="btn btn--fantasma" id="btn-notificacoes" title="Notificações">🔔<span id="contador-notif"></span></button>
          <button class="btn btn--fantasma" id="btn-tema" title="Alternar tema">◐</button>
          <button class="btn btn--fantasma" id="btn-perfil" title="Conta">👤</button>
        </header>
        <main class="conteudo" id="conteudo"></main>
      </div>
      <nav class="barra-inferior" id="barra-inferior"></nav>
    </div>`);

  document.body.innerHTML = '';
  document.body.appendChild(app);

  montarMenu();
  montarBarraInferior();
  ligarBusca();
  ligarAcoesTopo();
  aoMudar(() => { montarMenu(); atualizarContadorNotificacoes(); });
  atualizarContadorNotificacoes();
  ligarIndicadorSincronia();

  return qs('#conteudo');
}

/** Mostra pendências de envio e falhas de comunicação com o servidor. */
function ligarIndicadorSincronia() {
  const el = qs('#sincronia');
  if (!el) return;
  if (modoAtual() !== 'servidor') { el.textContent = 'modo local'; return; }
  el.textContent = '';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => enviarFila());
  aoSincronizar(({ pendentes, erro }) => {
    if (erro) {
      el.textContent = `⚠ ${pendentes} pendente(s)`;
      el.style.color = 'var(--c-fatal)';
      el.title = `Falha ao sincronizar: ${erro}. Clique para tentar novamente.`;
    } else if (pendentes) {
      el.textContent = `↻ ${pendentes}`;
      el.style.color = 'var(--c-proximo)';
      el.title = `${pendentes} alteração(ões) aguardando envio.`;
    } else {
      el.textContent = '';
      el.title = 'Tudo sincronizado com o servidor.';
    }
  });
}

export function montarMenu() {
  const nav = qs('#nav');
  if (!nav) return;
  const ind = indicadores();
  const contadores = {
    prazosAbertos: ind.vencidos + ind.prazosHoje,
    publicacoesPendentes: ind.publicacoesPendentes,
  };
  const atual = rotaAtual().nome;
  nav.innerHTML = MENU.map((g) => {
    const itens = g.itens.filter((i) => pode(i.permissao));
    if (!itens.length) return '';
    return `<div class="lateral__grupo">${esc(g.grupo)}</div>` + itens.map((i) => {
      const n = i.contador ? contadores[i.contador] : 0;
      return `<a class="nav-item ${atual === i.rota ? 'ativo' : ''}" href="#/${i.rota}">
        <span class="ico">${i.ico}</span>${esc(i.rotulo)}
        ${n ? `<span class="selo">${n}</span>` : ''}</a>`;
    }).join('');
  }).join('');

  const u = usuarioAtual();
  qs('#rodape-lateral').innerHTML = u
    ? `<div class="negrito">${esc(u.nome)}</div>
       <div class="mini" style="opacity:.75">${esc(u.email)}</div>`
    : '';
}

function montarBarraInferior() {
  const barra = qs('#barra-inferior');
  const atual = rotaAtual().nome;
  barra.innerHTML = MENU_MOBILE.map((i) =>
    `<a class="${atual === i.rota ? 'ativo' : ''}" href="#/${i.rota}">
      <span class="ico">${i.ico}</span>${esc(i.rotulo)}</a>`).join('');
}

export function atualizarNavegacao() { montarMenu(); montarBarraInferior(); }

export function definirTitulo(texto) {
  document.title = `${texto} · Sentinela`;
}

/* --------------------------------------------------------- busca global -- */

function ligarBusca() {
  const campo = qs('#busca');
  const caixa = qs('#busca-resultados');

  const buscar = debounce(() => {
    const termo = campo.value.trim();
    if (termo.length < 2) { caixa.classList.add('oculto'); return; }
    const resultados = buscaGlobal(termo);
    caixa.innerHTML = resultados.length
      ? resultados.map((r) => `<div class="busca__item" data-rota="${esc(r.rota)}">
          <span class="tipo">${esc(r.tipo)}</span>
          <span><span class="negrito">${esc(r.titulo)}</span>
          <span class="mini mudo"> ${esc(r.detalhe || '')}</span></span></div>`).join('')
      : '<div class="busca__item mudo">Nenhum resultado.</div>';
    caixa.classList.remove('oculto');
  }, 180);

  campo.addEventListener('input', buscar);
  campo.addEventListener('focus', buscar);
  delegar(caixa, 'click', '.busca__item', (_ev, el) => {
    if (!el.dataset.rota) return;
    caixa.classList.add('oculto'); campo.value = '';
    ir(el.dataset.rota);
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.busca')) caixa.classList.add('oculto');
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'k') { ev.preventDefault(); campo.focus(); }
  });
}

/* --------------------------------------------------------------- topo --- */

function ligarAcoesTopo() {
  const lateral = qs('#lateral');
  qs('#btn-menu').addEventListener('click', () => {
    lateral.classList.add('aberta');
    const veu = h('<div class="veu"></div>');
    veu.addEventListener('click', () => { lateral.classList.remove('aberta'); veu.remove(); });
    document.body.appendChild(veu);
  });
  delegar(lateral, 'click', '.nav-item', () => {
    lateral.classList.remove('aberta');
    qs('.veu')?.remove();
  });

  qs('#btn-tema').addEventListener('click', () => {
    const escuro = document.documentElement.dataset.tema === 'escuro';
    document.documentElement.dataset.tema = escuro ? 'claro' : 'escuro';
    localStorage.setItem('sentinela.tema', escuro ? 'claro' : 'escuro');
  });

  qs('#btn-notificacoes').addEventListener('click', abrirNotificacoes);

  qs('#btn-perfil').addEventListener('click', () => {
    const u = usuarioAtual();
    modal({
      titulo: 'Conta',
      conteudo: `<div class="pilha">
        <div><span class="negrito">${esc(u?.nome || '')}</span><br>
        <span class="mini mudo">${esc(u?.email || '')} · ${esc(u?.perfil || '')}</span></div>
        <div class="mini mudo">Último acesso: ${esc(fmtDataHora(u?.ultimoAcesso))}</div>
      </div>`,
      acoes: [
        { rotulo: 'Configurações', aoClicar: (fechar) => { fechar(); ir('configuracoes'); } },
        { rotulo: 'Sair', classe: 'btn--perigo', aoClicar: (fechar) => { fechar(); sair(); location.reload(); } },
      ],
    });
  });
}

export function atualizarContadorNotificacoes() {
  const el = qs('#contador-notif');
  if (!el) return;
  const n = db.listar('notificacoes').filter((x) => !x.lida).length;
  el.textContent = n ? ` ${n}` : '';
  el.style.color = n ? 'var(--c-fatal)' : '';
  el.style.fontWeight = '700';
}

export function abrirNotificacoes() {
  sincronizarNotificacoes();
  const lista = db.listar('notificacoes')
    .sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 60);
  const icone = { critico: '🔴', alto: '🟠', medio: '🔵', baixo: '🟢' };

  modal({
    titulo: 'Central de notificações',
    conteudo: lista.length ? `<ul class="lista">${lista.map((n) => `
      <li class="lista__item" data-rota="${esc(n.rota || '')}" data-id="${n.id}">
        <span>${icone[n.nivel] || '🔔'}</span>
        <div class="lista__corpo">
          <div class="lista__titulo">${esc(n.titulo)}${n.lida ? '' : ' <span class="selo selo--fatal">nova</span>'}</div>
          <div class="lista__meta">${esc(n.mensagem || '')}</div>
          <div class="mini mudo">${esc(fmtDataHora(n.data))}</div>
        </div>
      </li>`).join('')}</ul>` : '<div class="vazio">Nenhuma notificação.</div>',
    acoes: [
      { rotulo: 'Marcar todas como lidas', aoClicar: (fechar) => {
        db.listar('notificacoes').filter((n) => !n.lida)
          .forEach((n) => db.atualizar('notificacoes', n.id, { lida: true }));
        atualizarContadorNotificacoes(); fechar(); aviso('Notificações marcadas como lidas.', 'ok');
      } },
      { rotulo: 'Fechar', classe: 'btn--primario', aoClicar: (fechar) => fechar() },
    ],
    aoAbrir: (corpo, fechar) => {
      delegar(corpo, 'click', '.lista__item', (_e, el) => {
        db.atualizar('notificacoes', el.dataset.id, { lida: true });
        atualizarContadorNotificacoes();
        if (el.dataset.rota) { fechar(); ir(el.dataset.rota); }
      });
    },
  });
}
