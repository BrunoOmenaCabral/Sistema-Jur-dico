// Construtor de formulários orientado a especificação.
// Uma view descreve os campos; a validação, a montagem e a leitura ficam aqui.

import { h, qs, qsa, esc, modal } from './ui.js';

/**
 * @param {Array} campos [{ nome, rotulo, tipo, opcoes, valor, obrigatorio, ajuda, largura, atributos }]
 *   tipo: text | textarea | date | time | number | select | checkbox | money | tel | email | oculto
 *   largura: 1 (padrão), 2 ou 3 colunas em telas largas
 */
export function montarFormulario(campos, valores = {}) {
  const form = h('<form class="form" novalidate></form>');
  let linha = null, ocupado = 0;

  for (const c of campos) {
    if (c.tipo === 'separador') {
      form.appendChild(h(`<h3 style="margin-top:.4rem">${esc(c.rotulo)}</h3>`));
      linha = null; ocupado = 0; continue;
    }
    const largura = Math.min(c.largura || 1, 3);
    if (!linha || ocupado + largura > 3 || largura === 1 && ocupado >= 3) {
      linha = h('<div class="form__linha"></div>');
      form.appendChild(linha); ocupado = 0;
    }
    linha.className = `form__linha form__linha--${Math.max(2, largura + ocupado) === 3 ? 3 : 2}`;
    linha.appendChild(campoHTML(c, valores[c.nome] ?? c.valor ?? ''));
    ocupado += largura;
    if (ocupado >= 3) { linha = null; ocupado = 0; }
  }
  return form;
}

function campoHTML(c, valor) {
  const id = `f_${c.nome}`;
  const obrig = c.obrigatorio ? ' <span style="color:var(--c-fatal)">*</span>' : '';
  const attrs = Object.entries(c.atributos || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  const ajuda = c.ajuda ? `<span class="campo__ajuda">${esc(c.ajuda)}</span>` : '';

  if (c.tipo === 'oculto') return h(`<input type="hidden" name="${c.nome}" value="${esc(valor)}">`);

  if (c.tipo === 'checkbox') {
    return h(`<div class="campo campo--linha">
      <input type="checkbox" id="${id}" name="${c.nome}" ${valor ? 'checked' : ''} ${attrs}>
      <label for="${id}">${esc(c.rotulo)}</label>${ajuda}</div>`);
  }
  if (c.tipo === 'select') {
    const ops = (c.opcoes || []).map((o) => {
      const v = typeof o === 'string' ? o : o.valor;
      const r = typeof o === 'string' ? o : o.rotulo;
      return `<option value="${esc(v)}" ${String(v) === String(valor) ? 'selected' : ''}>${esc(r)}</option>`;
    }).join('');
    return h(`<div class="campo"><label for="${id}">${esc(c.rotulo)}${obrig}</label>
      <select id="${id}" name="${c.nome}" ${attrs}>${c.vazio === false ? '' : `<option value="">${esc(c.placeholder || '— selecione —')}</option>`}${ops}</select>${ajuda}</div>`);
  }
  if (c.tipo === 'textarea') {
    return h(`<div class="campo"><label for="${id}">${esc(c.rotulo)}${obrig}</label>
      <textarea id="${id}" name="${c.nome}" ${attrs}>${esc(valor)}</textarea>${ajuda}</div>`);
  }
  const tipo = { money: 'number', tel: 'tel', email: 'email' }[c.tipo] || c.tipo || 'text';
  const passo = c.tipo === 'money' ? 'step="0.01"' : '';
  return h(`<div class="campo"><label for="${id}">${esc(c.rotulo)}${obrig}</label>
    <input type="${tipo}" id="${id}" name="${c.nome}" value="${esc(valor)}" ${passo} ${attrs}>${ajuda}</div>`);
}

export function lerFormulario(form, campos) {
  const dados = {};
  for (const c of campos) {
    if (c.tipo === 'separador') continue;
    const el = form.elements[c.nome];
    if (!el) continue;
    if (c.tipo === 'checkbox') dados[c.nome] = el.checked;
    else if (c.tipo === 'number' || c.tipo === 'money') dados[c.nome] = el.value === '' ? null : Number(el.value);
    else dados[c.nome] = el.value.trim();
  }
  return dados;
}

export function validar(form, campos) {
  const erros = [];
  qsa('.campo--erro', form).forEach((el) => el.classList.remove('campo--erro'));
  for (const c of campos) {
    if (!c.obrigatorio || c.tipo === 'separador') continue;
    const el = form.elements[c.nome];
    if (!el) continue;
    const vazio = c.tipo === 'checkbox' ? !el.checked : !String(el.value).trim();
    if (vazio) {
      erros.push(`Informe ${c.rotulo.toLowerCase()}.`);
      el.closest('.campo')?.classList.add('campo--erro');
    }
  }
  return erros;
}

/**
 * Modal de formulário completo. `aoSalvar(dados, ctx)` pode devolver `false`
 * para manter o modal aberto (por exemplo, quando há avisos a confirmar).
 */
export function modalFormulario({ titulo, campos, valores = {}, rotuloSalvar = 'Salvar',
  largo = false, aoSalvar, extras }) {
  const form = montarFormulario(campos, valores);
  const caixaAvisos = h('<div data-avisos></div>');
  const envolucro = h('<div></div>');
  envolucro.appendChild(caixaAvisos);
  envolucro.appendChild(form);
  if (extras) envolucro.appendChild(typeof extras === 'string' ? h(`<div>${extras}</div>`) : extras);

  const ref = modal({
    titulo, conteudo: envolucro, largo,
    acoes: [
      { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
      {
        rotulo: rotuloSalvar, classe: 'btn--primario',
        aoClicar: async (fechar) => {
          const erros = validar(form, campos);
          if (erros.length) {
            caixaAvisos.innerHTML = erros.map((e) => `<div class="aviso aviso--alerta">${esc(e)}</div>`).join('');
            return;
          }
          const dados = lerFormulario(form, campos);
          const r = await aoSalvar(dados, { form, fechar, avisos: caixaAvisos });
          if (r !== false) fechar();
        },
      },
    ],
  });
  return { form, avisos: caixaAvisos, fechar: ref.fechar };
}
