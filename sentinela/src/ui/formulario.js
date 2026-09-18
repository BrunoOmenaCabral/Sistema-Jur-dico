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
  if (c.tipo === 'autocompletar') return campoAutocompletar(c, valor, id, obrig, ajuda);

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


/* ------------------------------------------------ campo com sugestões ---- */

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

/**
 * Campo de texto que sugere registros já cadastrados enquanto se digita.
 *
 * Serve ao número de processo: digitando-se os primeiros algarismos, aparece o
 * que já existe na base; não aparecendo nada, o que foi digitado vale como está,
 * porque o processo pode ainda não ter sido cadastrado.
 *
 * `opcoes`: [{ valor, rotulo, secundario, termos }]. O campo devolve
 * `{ id, texto }`: o identificador do registro escolhido, quando houve escolha,
 * e sempre o texto tal como digitado.
 */
function campoAutocompletar(c, valor, id, obrig, ajuda) {
  const opcoes = (c.opcoes || []).map((o) => ({
    ...o,
    busca: semAcento(`${o.rotulo || ''} ${o.secundario || ''} ${o.termos || ''}`),
    digitos: soDigitos(`${o.rotulo || ''} ${o.termos || ''}`),
  }));

  const caixa = h(`<div class="campo">
    <label for="${id}">${esc(c.rotulo)}${obrig}</label>
    <div class="sugestao">
      <input type="text" id="${id}" autocomplete="off" role="combobox" aria-expanded="false"
        aria-autocomplete="list" value="${esc(valor)}" placeholder="${esc(c.placeholder || '')}">
      <input type="hidden" name="${c.nome}" value="">
    </div>
    <span class="campo__escolhido mini mudo"></span>${ajuda}</div>`);

  const entrada = qs('input[type="text"]', caixa);
  const oculto = qs('input[type="hidden"]', caixa);
  const escolhido = qs('.campo__escolhido', caixa);

  // A lista fica presa ao corpo da página: dentro do formulário ela seria
  // cortada pela rolagem do modal, e a sugestão que não se vê não serve.
  const lista = h('<ul class="sugestao__lista" role="listbox" hidden></ul>');
  let visiveis = [];
  let marcado = -1;

  const posicionar = () => {
    const r = entrada.getBoundingClientRect();
    lista.style.left = `${r.left}px`;
    lista.style.width = `${r.width}px`;
    // Abre para cima quando não há espaço abaixo.
    const espacoAbaixo = window.innerHeight - r.bottom;
    if (espacoAbaixo < 180 && r.top > espacoAbaixo) {
      lista.style.top = 'auto';
      lista.style.bottom = `${window.innerHeight - r.top + 2}px`;
    } else {
      lista.style.bottom = 'auto';
      lista.style.top = `${r.bottom + 2}px`;
    }
  };

  const fechar = () => {
    lista.hidden = true; lista.innerHTML = ''; visiveis = []; marcado = -1;
    lista.remove();
    entrada.setAttribute('aria-expanded', 'false');
  };

  const marcar = (i) => {
    marcado = i;
    [...lista.children].forEach((el, n) => el.classList.toggle('sugestao__item--ativo', n === i));
  };

  const escolher = (o) => {
    oculto.value = o.valor;
    entrada.value = o.rotulo;
    escolhido.textContent = o.secundario || '';
    fechar();
    entrada.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const filtrar = () => {
    const texto = semAcento(entrada.value.trim());
    const digitos = soDigitos(entrada.value);
    if (!texto) { fechar(); return; }

    visiveis = opcoes.filter((o) => (digitos.length >= 2 && o.digitos.includes(digitos))
      || (texto.length >= 2 && o.busca.includes(texto))).slice(0, 8);

    if (!visiveis.length) { fechar(); return; }
    lista.innerHTML = visiveis.map((o, i) => `<li class="sugestao__item" role="option" data-i="${i}">
      <span class="negrito">${esc(o.rotulo)}</span>
      ${o.secundario ? `<span class="mini mudo">${esc(o.secundario)}</span>` : ''}</li>`).join('');
    if (!lista.isConnected) document.body.appendChild(lista);
    lista.hidden = false;
    posicionar();
    entrada.setAttribute('aria-expanded', 'true');
    marcar(0);
  };

  // Rolagem e redimensionamento movem o campo; a lista acompanha. Fechado o
  // formulário, o campo sai da página e os ouvintes saem com ele.
  const acompanhar = () => {
    if (!entrada.isConnected) {
      fechar();
      window.removeEventListener('scroll', acompanhar, true);
      window.removeEventListener('resize', acompanhar);
      return;
    }
    if (!lista.hidden) posicionar();
  };
  window.addEventListener('scroll', acompanhar, true);
  window.addEventListener('resize', acompanhar);

  entrada.addEventListener('input', () => {
    // Texto alterado depois da escolha deixa de corresponder ao registro.
    oculto.value = '';
    escolhido.textContent = '';
    filtrar();
  });
  entrada.addEventListener('focus', filtrar);
  entrada.addEventListener('blur', () => setTimeout(fechar, 150));
  entrada.addEventListener('keydown', (ev) => {
    if (lista.hidden) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); marcar(Math.min(marcado + 1, visiveis.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); marcar(Math.max(marcado - 1, 0)); }
    else if (ev.key === 'Enter' && visiveis[marcado]) { ev.preventDefault(); escolher(visiveis[marcado]); }
    else if (ev.key === 'Escape') fechar();
  });
  lista.addEventListener('mousedown', (ev) => {
    const item = ev.target.closest('.sugestao__item');
    if (item) { ev.preventDefault(); escolher(visiveis[Number(item.dataset.i)]); }
  });

  return caixa;
}

export function lerFormulario(form, campos) {
  const dados = {};
  for (const c of campos) {
    if (c.tipo === 'separador') continue;
    const el = form.elements[c.nome];
    if (!el) continue;
    if (c.tipo === 'autocompletar') {
      // Devolve o registro escolhido e o texto digitado: sem escolha, o texto é
      // o que vale, porque pode se referir a algo ainda não cadastrado.
      const texto = form.querySelector(`#f_${c.nome}`)?.value.trim() || '';
      dados[c.nome] = { id: el.value || null, texto };
    } else if (c.tipo === 'checkbox') dados[c.nome] = el.checked;
    else if (c.tipo === 'number' || c.tipo === 'money') dados[c.nome] = el.value === '' ? null : Number(el.value);
    // Senha vai como foi digitada: espaço no início ou no fim é parte dela.
    else if (c.tipo === 'password') dados[c.nome] = el.value;
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
    const vazio = c.tipo === 'checkbox' ? !el.checked
      : c.tipo === 'autocompletar' ? !(form.querySelector(`#f_${c.nome}`)?.value || '').trim()
        : !String(el.value).trim();
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
