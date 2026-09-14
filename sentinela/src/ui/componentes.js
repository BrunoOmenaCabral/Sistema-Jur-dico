// Componentes reutilizados por várias telas: calendário mensal, listas de
// compromissos, cabeçalho de página e cartões de indicador.

import { h, esc, qs, delegar } from './ui.js';
import { db } from '../core/store.js';
import {
  MESES, DIAS_SEMANA_CURTO, diasNoMes, iso, hoje, addDays, fmtData, toDate, fmtCNJ,
} from '../core/util.js';
import {
  corDoItem, situacaoPrazo, rotuloSituacao, nomeCliente, nomeUsuario, processoDe,
  calendarioConfigurado,
} from '../core/dominio.js';
import { calendarioAplicavel, feriadoEm } from '../core/calculo-prazo.js';
import { ir } from './roteador.js';

export function cabecalhoPagina(titulo, acoes = '', subtitulo = '') {
  return `<div class="pagina__cabecalho">
    <div><h1>${esc(titulo)}</h1>${subtitulo ? `<div class="mini mudo">${esc(subtitulo)}</div>` : ''}</div>
    <div class="pagina__acoes">${acoes}</div>
  </div>`;
}

export function cartaoIndicador({ rotulo, valor, nota, variante = '', rota }) {
  return `<div class="indicador ${variante ? `indicador--${variante}` : ''}"
      ${rota ? `data-rota="${esc(rota)}"` : ''}>
    <div class="indicador__rotulo">${esc(rotulo)}</div>
    <div class="indicador__valor">${esc(String(valor))}</div>
    ${nota ? `<div class="indicador__nota">${esc(nota)}</div>` : ''}
  </div>`;
}

export function ligarIndicadores(raiz) {
  delegar(raiz, 'click', '[data-rota]', (_e, el) => { if (el.dataset.rota) ir(el.dataset.rota); });
}

/* ---------------------------------------------------------- calendário -- */

/**
 * Calendário mensal de segunda a domingo. Cada dia lista resumidamente os
 * compromissos, com cor por tipo e marcação de vencido, hoje e futuro.
 */
export function calendarioMensal({ ano, mes, eventos, aoClicarDia, maxPorDia = 3 }) {
  const primeiro = new Date(ano, mes, 1);
  const deslocamento = (primeiro.getDay() + 6) % 7; // segunda = 0
  const total = diasNoMes(ano, mes);
  const inicio = addDays(iso(primeiro), -deslocamento);
  const celulas = Math.ceil((deslocamento + total) / 7) * 7;
  const cal = calendarioAplicavel([ano - 1, ano, ano + 1], {}, calendarioConfigurado());

  const porDia = eventos.reduce((acc, e) => { (acc[e.data] ||= []).push(e); return acc; }, {});
  const cabecalho = DIAS_SEMANA_CURTO.map((d) => `<div class="cal__cabecalho">${d}</div>`).join('');

  let grade = '';
  for (let i = 0; i < celulas; i += 1) {
    const dia = addDays(inicio, i);
    const d = toDate(dia);
    const fora = d.getMonth() !== mes;
    const fds = [0, 6].includes(d.getDay());
    const feriado = feriadoEm(dia, cal);
    const doDia = porDia[dia] || [];
    const visiveis = doDia.slice(0, maxPorDia);

    grade += `<div class="cal__dia ${fora ? 'cal__dia--fora' : ''} ${fds ? 'cal__dia--fds' : ''}
        ${dia === hoje() ? 'cal__dia--hoje' : ''} ${feriado ? 'cal__dia--feriado' : ''}"
        data-dia="${dia}" ${feriado ? `data-feriado="${esc(feriado.nome)}"` : ''}>
      <div class="cal__num">${d.getDate()}</div>
      ${visiveis.map((e) => `<div class="cal__evento ${e.status === 'concluido' ? 'cal__evento--concluido' : ''}"
          title="${esc(rotuloEvento(e))}">
          <span class="ponto" style="background:${corDoItem(e)}"></span>${esc(e.titulo)}
        </div>`).join('')}
      ${doDia.length > visiveis.length ? `<div class="cal__mais">+${doDia.length - visiveis.length} outros</div>` : ''}
    </div>`;
  }

  // No celular a grade rola horizontalmente para manter os dias legíveis.
  const el = h(`<div class="cal__rolagem"><div class="cal__grade">${cabecalho}${grade}</div></div>`);
  delegar(el, 'click', '.cal__dia', (_ev, celula) => aoClicarDia?.(celula.dataset.dia));
  return el;
}

export function rotuloEvento(e) {
  const proc = e.processoId ? processoDe(e.processoId) : null;
  return [e.titulo, proc ? fmtCNJ(proc.numeroCNJ) : null, nomeCliente(e.clienteId),
    e.responsavelId ? `resp. ${nomeUsuario(e.responsavelId)}` : null,
    e.hora ? `${e.hora}` : null].filter(Boolean).join(' · ');
}

/* -------------------------------------------------------------- listas -- */

const ICONE_TIPO = { prazo: '⏱', tarefa: '✓', audiencia: '⚖', publicacao: '📰' };

export function itemEventoHTML(e) {
  const situacao = e.situacao || situacaoPrazo(e);
  const variante = { vencido: 'fatal', hoje: 'fatal', critico: 'proximo', proximo: 'tarefa',
    concluido: 'ok', cancelado: 'neutro' }[situacao] || 'neutro';
  const proc = e.processoId ? processoDe(e.processoId) : null;
  return `<li class="lista__item" data-rota="${esc(e.rota || '')}">
    <span class="lista__faixa" style="background:${corDoItem(e)}"></span>
    <div class="lista__corpo">
      <div class="lista__titulo">${ICONE_TIPO[e.tipoRegistro] || '•'} ${esc(e.titulo)}</div>
      <div class="lista__meta">
        ${proc ? `<span class="mono">${esc(fmtCNJ(proc.numeroCNJ))}</span>` : ''}
        <span>${esc(nomeCliente(e.clienteId || proc?.clienteId))}</span>
        ${e.responsavelId ? `<span>resp. ${esc(nomeUsuario(e.responsavelId))}</span>` : ''}
        ${e.hora ? `<span>${esc(e.hora)}</span>` : ''}
      </div>
    </div>
    <div class="lista__lado">
      <div>${esc(fmtData(e.data))}</div>
      <span class="selo selo--${variante}">${esc(rotuloSituacao(situacao))}</span>
    </div>
  </li>`;
}

export function listaEventos(eventos, textoVazio = 'Nenhum compromisso no período.') {
  if (!eventos.length) return `<div class="vazio"><span class="ico">📭</span>${esc(textoVazio)}</div>`;
  return `<ul class="lista">${eventos.map(itemEventoHTML).join('')}</ul>`;
}

/** Abre o resumo do dia a partir do calendário. */
export function detalhesDoDia(dia, eventos, modal) {
  const doDia = eventos.filter((e) => e.data === dia);
  modal({
    titulo: fmtData(dia),
    conteudo: `<div class="pilha">
      ${listaEventos(doDia, 'Nenhum compromisso neste dia.')}
    </div>`,
    acoes: [
      { rotulo: 'Novo prazo', aoClicar: (fechar) => { fechar(); ir(`prazos/novo/${dia}`); } },
      { rotulo: 'Fechar', classe: 'btn--primario', aoClicar: (fechar) => fechar() },
    ],
    aoAbrir: (corpo, fechar) => {
      delegar(corpo, 'click', '.lista__item', (_e, el) => {
        if (el.dataset.rota) { fechar(); ir(el.dataset.rota); }
      });
    },
  });
}

/* ------------------------------------------------------------- seletores */

export const opcoesClientes = () => db.listar('clientes')
  .map((c) => ({ valor: c.id, rotulo: c.nome }));

export const opcoesProcessos = () => db.listar('processos')
  .map((p) => ({ valor: p.id, rotulo: `${fmtCNJ(p.numeroCNJ)} — ${nomeCliente(p.clienteId)}` }));

export const opcoesUsuarios = () => db.listar('usuarios')
  .filter((u) => u.ativo !== false).map((u) => ({ valor: u.id, rotulo: u.nome }));
