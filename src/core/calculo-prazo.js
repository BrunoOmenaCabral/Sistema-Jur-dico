// Motor de contagem de prazos processuais.
//
// Princípio adotado: o sistema nunca presume silenciosamente a regra de
// contagem. Toda apuração devolve a memória de cálculo — fundamento legal,
// termo inicial, dias computados e dias desprezados com o respectivo motivo —
// para que a regra utilizada fique registrada junto ao prazo.

import { addDays, iso, toDate, diffDias, fmtData } from './util.js';
import {
  calendarioAplicavel, ehDiaUtil, motivoNaoUtil, proximoDiaUtil, feriadoEm, suspensaoEm,
} from './feriados.js';

export const CONTAGENS = {
  uteis: {
    rotulo: 'Dias úteis',
    fundamento: 'art. 219 do CPC — na contagem de prazo em dias, computam-se somente os dias úteis.',
  },
  corridos: {
    rotulo: 'Dias corridos',
    fundamento: 'prazo material ou legislação específica — contagem em dias corridos.',
  },
};

/** Tipos de prazo com sugestão de contagem e de quantidade padrão de dias. */
export const TIPOS_PRAZO = [
  { id: 'contestacao', rotulo: 'Contestação', dias: 15, contagem: 'uteis' },
  { id: 'replica', rotulo: 'Réplica', dias: 15, contagem: 'uteis' },
  { id: 'recurso', rotulo: 'Recurso', dias: 15, contagem: 'uteis' },
  { id: 'contrarrazoes', rotulo: 'Contrarrazões', dias: 15, contagem: 'uteis' },
  { id: 'manifestacao', rotulo: 'Manifestação', dias: 15, contagem: 'uteis' },
  { id: 'embargos', rotulo: 'Embargos de declaração', dias: 5, contagem: 'uteis' },
  { id: 'agravo', rotulo: 'Agravo', dias: 15, contagem: 'uteis' },
  { id: 'apelacao', rotulo: 'Apelação', dias: 15, contagem: 'uteis' },
  { id: 'cumprimento', rotulo: 'Cumprimento de sentença', dias: 15, contagem: 'uteis' },
  { id: 'pagamento', rotulo: 'Pagamento', dias: 15, contagem: 'corridos' },
  { id: 'audiencia', rotulo: 'Audiência', dias: null, contagem: 'corridos' },
  { id: 'sustentacao', rotulo: 'Sustentação oral', dias: null, contagem: 'corridos' },
  { id: 'despacho', rotulo: 'Cumprimento de despacho', dias: 5, contagem: 'uteis' },
  { id: 'interna', rotulo: 'Providência interna', dias: null, contagem: 'corridos' },
  { id: 'outros', rotulo: 'Outros', dias: null, contagem: 'uteis' },
];

export const tipoPrazo = (id) => TIPOS_PRAZO.find((t) => t.id === id) || TIPOS_PRAZO.at(-1);

/**
 * Calcula o vencimento de um prazo processual.
 *
 * @param {object} p
 *  - dataDisponibilizacao: publicação no Diário (opcional)
 *  - dataPublicacao: data em que se considera publicado (opcional se houver disponibilização)
 *  - dias: quantidade do prazo
 *  - contagem: 'uteis' | 'corridos'
 *  - multiplicador: 1 (padrão) ou 2 (prazo em dobro — art. 183, 186 e 229 do CPC)
 *  - inicioManual: ignora a regra do art. 224 e inicia a contagem na data informada
 *  - contexto: { uf, municipio, tribunal }
 *  - calendario: { feriados: [], suspensoes: [], recessoForense: bool }
 * @returns memória de cálculo completa
 */
export function calcularPrazo(p) {
  const dias = Number(p.dias) * (Number(p.multiplicador) || 1);
  const contagem = p.contagem === 'corridos' ? 'corridos' : 'uteis';
  const passos = [];

  const baseAno = Number(String(p.dataDisponibilizacao || p.dataPublicacao || p.inicioManual || iso(new Date())).slice(0, 4));
  const cal = calendarioAplicavel([baseAno - 1, baseAno, baseAno + 1], p.contexto || {}, p.calendario || {});

  if (!dias || dias <= 0) {
    return { erro: 'Informe a quantidade de dias do prazo.', passos };
  }

  // 1. Data da publicação (CPC, art. 224, §2º).
  let dataPublicacao = p.dataPublicacao || null;
  if (p.dataDisponibilizacao && !dataPublicacao) {
    dataPublicacao = proximoDiaUtil(addDays(p.dataDisponibilizacao, 1), cal);
    passos.push(`Disponibilização em ${fmtData(p.dataDisponibilizacao)}. Considera-se publicado em `
      + `${fmtData(dataPublicacao)}, primeiro dia útil seguinte (art. 224, §2º, do CPC).`);
  } else if (dataPublicacao) {
    passos.push(`Data da publicação informada: ${fmtData(dataPublicacao)}.`);
  }

  // 2. Termo inicial da contagem (CPC, art. 224, caput e §3º).
  let inicio;
  if (p.inicioManual) {
    inicio = p.inicioManual;
    passos.push(`Termo inicial definido manualmente em ${fmtData(inicio)}.`);
  } else if (dataPublicacao) {
    inicio = proximoDiaUtil(addDays(dataPublicacao, 1), cal);
    passos.push(`Exclui-se o dia da publicação. A contagem inicia em ${fmtData(inicio)}, `
      + 'primeiro dia útil subsequente (art. 224, caput e §3º, do CPC).');
  } else {
    return { erro: 'Informe a data de publicação, de disponibilização ou o termo inicial.', passos };
  }

  // 3. Contagem propriamente dita.
  const computados = [];
  const desprezados = [];
  let cursor = inicio;
  let restantes = dias;
  let guarda = 0;
  let vencimento = inicio;

  if (contagem === 'uteis') {
    while (restantes > 0 && guarda++ < 4000) {
      if (ehDiaUtil(cursor, cal)) {
        computados.push(cursor);
        restantes -= 1;
        vencimento = cursor;
      } else {
        desprezados.push({ data: cursor, motivo: motivoNaoUtil(cursor, cal) });
      }
      if (restantes > 0) cursor = addDays(cursor, 1);
    }
  } else {
    vencimento = addDays(inicio, dias - 1);
    for (let d = inicio; d <= vencimento; d = addDays(d, 1)) {
      computados.push(d);
      const motivo = motivoNaoUtil(d, cal);
      if (motivo) desprezados.push({ data: d, motivo: `${motivo} (computado — contagem corrida)` });
    }
    passos.push(`${dias} dias corridos a partir de ${fmtData(inicio)}.`);
  }

  if (contagem === 'uteis') {
    passos.push(`${dias} dias úteis computados entre ${fmtData(inicio)} e ${fmtData(vencimento)} `
      + `(${desprezados.length} dias desprezados).`);
  }

  // 4. Prorrogação do vencimento (CPC, art. 224, §1º).
  const vencimentoBruto = vencimento;
  if (!ehDiaUtil(vencimento, cal)) {
    const motivo = motivoNaoUtil(vencimento, cal);
    vencimento = proximoDiaUtil(vencimento, cal);
    passos.push(`O termo final recairia em ${fmtData(vencimentoBruto)} (${motivo}). `
      + `Prorroga-se para ${fmtData(vencimento)} (art. 224, §1º, do CPC).`);
  }

  const suspensaoNoPeriodo = [...new Set(
    computados.concat(desprezados.map((d) => d.data))
      .map((d) => suspensaoEm(d, cal)?.descricao).filter(Boolean),
  )];

  return {
    dataDisponibilizacao: p.dataDisponibilizacao || null,
    dataPublicacao,
    inicio,
    vencimento,
    vencimentoBruto,
    dias,
    diasBase: Number(p.dias),
    multiplicador: Number(p.multiplicador) || 1,
    contagem,
    rotuloContagem: CONTAGENS[contagem].rotulo,
    fundamento: CONTAGENS[contagem].fundamento,
    contexto: p.contexto || {},
    passos,
    desprezados,
    totalComputados: computados.length,
    suspensoes: suspensaoNoPeriodo,
    resumoRegra: montarResumoRegra(p, contagem, dias),
  };
}

function montarResumoRegra(p, contagem, dias) {
  const partes = [`${dias} ${CONTAGENS[contagem].rotulo.toLowerCase()}`];
  if ((Number(p.multiplicador) || 1) > 1) partes.push('prazo em dobro');
  if (p.contexto?.tribunal) partes.push(`calendário do ${p.contexto.tribunal}`);
  if (p.contexto?.uf) partes.push(`feriados de ${p.contexto.uf}`);
  if (p.inicioManual) partes.push('termo inicial manual');
  else partes.push('art. 224 do CPC');
  return partes.join(' · ');
}

/** Dias úteis restantes entre duas datas, útil para semáforos de urgência. */
export function diasUteisAte(dataAlvo, deData, contexto = {}, calendarioCfg = {}) {
  const a = iso(toDate(deData)), b = iso(toDate(dataAlvo));
  if (!a || !b || b < a) return diffDias(a, b);
  const anos = [Number(a.slice(0, 4)), Number(b.slice(0, 4))];
  const cal = calendarioAplicavel([...new Set(anos)], contexto, calendarioCfg);
  let n = 0;
  for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) if (ehDiaUtil(d, cal)) n += 1;
  return n;
}

export { calendarioAplicavel, ehDiaUtil, feriadoEm, suspensaoEm, proximoDiaUtil };
