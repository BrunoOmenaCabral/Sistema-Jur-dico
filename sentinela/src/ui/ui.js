// Primitivas de interface: criação de elementos, avisos, modais e confirmação.

import { escapeHtml } from '../core/util.js';

export const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
};
export const qs = (sel, raiz = document) => raiz.querySelector(sel);
export const qsa = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
export const esc = escapeHtml;

/** Delegação de eventos: evita reanexar ouvintes a cada renderização. */
export function delegar(raiz, evento, seletor, manipulador) {
  raiz.addEventListener(evento, (ev) => {
    const alvo = ev.target.closest(seletor);
    if (alvo && raiz.contains(alvo)) manipulador(ev, alvo);
  });
}

/* ---------------------------------------------------------------- avisos */

let caixaAvisos;
export function aviso(mensagem, tipo = 'info', ms = 4000) {
  caixaAvisos ||= document.body.appendChild(h('<div class="avisos-toast"></div>'));
  const el = h(`<div class="toast toast--${tipo}">${esc(mensagem)}</div>`);
  caixaAvisos.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, ms);
}

/* ---------------------------------------------------------------- modal */

/**
 * Abre um modal. `conteudo` pode ser HTML ou elemento.
 * `acoes`: [{ rotulo, classe, aoClicar(fechar, corpo) }]
 */
export function modal({ titulo, conteudo, acoes = [], largo = false, aoAbrir }) {
  const fundo = h('<div class="modal-fundo"></div>');
  const caixa = h(`
    <div class="modal ${largo ? 'modal--largo' : ''}" role="dialog" aria-modal="true">
      <div class="modal__cabecalho">
        <h2>${esc(titulo)}</h2>
        <button class="btn btn--fantasma" data-fechar aria-label="Fechar">✕</button>
      </div>
      <div class="modal__corpo"></div>
      <div class="modal__rodape"></div>
    </div>`);
  const corpo = qs('.modal__corpo', caixa);
  const rodape = qs('.modal__rodape', caixa);
  if (typeof conteudo === 'string') corpo.innerHTML = conteudo;
  else if (conteudo) corpo.appendChild(conteudo);

  const fechar = () => { fundo.remove(); document.body.style.overflow = ''; };
  for (const a of acoes) {
    const btn = h(`<button class="btn ${a.classe || ''}">${esc(a.rotulo)}</button>`);
    btn.addEventListener('click', () => a.aoClicar?.(fechar, corpo, btn));
    rodape.appendChild(btn);
  }
  if (!acoes.length) rodape.remove();

  fundo.appendChild(caixa);
  fundo.addEventListener('click', (ev) => { if (ev.target === fundo) fechar(); });
  qs('[data-fechar]', caixa).addEventListener('click', fechar);
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc2); }
  });
  document.body.appendChild(fundo);
  document.body.style.overflow = 'hidden';
  aoAbrir?.(corpo, fechar);
  return { fechar, corpo };
}

/** Confirmação explícita — obrigatória antes de excluir informação jurídica. */
export function confirmar({ titulo = 'Confirmar', mensagem, rotuloOk = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    modal({
      titulo,
      conteudo: `<p class="quebra">${esc(mensagem)}</p>`,
      acoes: [
        { rotulo: 'Cancelar', aoClicar: (fechar) => { fechar(); resolve(false); } },
        { rotulo: rotuloOk, classe: perigo ? 'btn--perigo' : 'btn--primario',
          aoClicar: (fechar) => { fechar(); resolve(true); } },
      ],
    });
  });
}

export const vazio = (texto, icone = '🗂️') =>
  `<div class="vazio"><span class="ico">${icone}</span>${esc(texto)}</div>`;

export const selo = (texto, variante = 'neutro') =>
  `<span class="selo selo--${variante}">${esc(texto)}</span>`;
