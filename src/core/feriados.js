// Calendário forense: feriados nacionais, estaduais, municipais, feriados
// próprios de tribunais e períodos de suspensão de expediente.
//
// Os feriados móveis derivam da Páscoa (algoritmo de Meeus/Jones/Butcher),
// portanto o motor funciona para qualquer ano sem tabela fixa.

import { iso, toDate, addDays, isFimDeSemana, norm } from './util.js';

export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(ano, mes - 1, dia, 12));
}

/** Feriados nacionais (Lei 662/1949, Lei 10.607/2002 e Lei 14.759/2023). */
export function feriadosNacionais(ano) {
  const p = pascoa(ano);
  const fixos = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Consciência Negra'],
    ['12-25', 'Natal'],
  ].map(([md, nome]) => ({ data: `${ano}-${md}`, nome, abrangencia: 'nacional' }));

  const moveis = [
    [-48, 'Carnaval'],
    [-47, 'Carnaval'],
    [-2, 'Sexta-feira Santa'],
    [60, 'Corpus Christi'],
  ].map(([off, nome]) => ({ data: addDays(p, off), nome, abrangencia: 'nacional' }));

  return [...fixos, ...moveis];
}

/**
 * Suspensões automáticas de prazo previstas em lei.
 * CPC art. 220: prazos suspensos entre 20 de dezembro e 20 de janeiro.
 */
export function suspensoesLegais(ano) {
  return [
    {
      inicio: `${ano}-12-20`, fim: `${ano + 1}-01-20`,
      descricao: 'Suspensão de prazos — art. 220 do CPC',
      abrangencia: 'nacional', legal: true,
    },
  ];
}

/**
 * Consolida o calendário aplicável a um processo.
 * @param {number[]} anos anos que precisam estar cobertos
 * @param {object} ctx  { uf, municipio, tribunal }
 * @param {object} cfg  { feriados: [], suspensoes: [], recessoForense: bool }
 */
export function calendarioAplicavel(anos, ctx = {}, cfg = {}) {
  const uf = norm(ctx.uf), municipio = norm(ctx.municipio), tribunal = norm(ctx.tribunal);
  const feriados = new Map();
  const suspensoes = [];

  const aceita = (f) => {
    switch (f.abrangencia) {
      case 'nacional': return true;
      case 'estadual': return !!uf && norm(f.uf) === uf;
      case 'municipal': return !!municipio && norm(f.municipio) === municipio
        && (!f.uf || norm(f.uf) === uf);
      case 'tribunal': return !!tribunal && norm(f.tribunal) === tribunal;
      default: return true;
    }
  };

  for (const ano of anos) {
    for (const f of feriadosNacionais(ano)) feriados.set(f.data, f);
    if (cfg.recessoForense !== false) suspensoes.push(...suspensoesLegais(ano - 1), ...suspensoesLegais(ano));
  }
  for (const f of (cfg.feriados || [])) {
    if (aceita(f) && f.data) feriados.set(f.data, f);
  }
  for (const s of (cfg.suspensoes || [])) {
    if (aceita(s)) suspensoes.push(s);
  }
  return { feriados, suspensoes };
}

export function feriadoEm(data, calendario) {
  return calendario.feriados.get(iso(toDate(data))) || null;
}

export function suspensaoEm(data, calendario) {
  const d = iso(toDate(data));
  return calendario.suspensoes.find((s) => d >= s.inicio && d <= s.fim) || null;
}

/** Dia útil forense: não é fim de semana, feriado nem período de suspensão. */
export function ehDiaUtil(data, calendario) {
  if (isFimDeSemana(data)) return false;
  if (feriadoEm(data, calendario)) return false;
  if (suspensaoEm(data, calendario)) return false;
  return true;
}

export function motivoNaoUtil(data, calendario) {
  if (isFimDeSemana(data)) return 'fim de semana';
  const f = feriadoEm(data, calendario);
  if (f) return `feriado — ${f.nome}`;
  const s = suspensaoEm(data, calendario);
  if (s) return `expediente suspenso — ${s.descricao}`;
  return null;
}

export function proximoDiaUtil(data, calendario, incluirPropria = true) {
  let d = iso(toDate(data));
  if (!incluirPropria) d = addDays(d, 1);
  let guarda = 0;
  while (!ehDiaUtil(d, calendario) && guarda++ < 400) d = addDays(d, 1);
  return d;
}
