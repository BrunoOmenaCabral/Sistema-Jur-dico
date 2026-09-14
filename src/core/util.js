// Utilitários gerais: datas, formatação, identificadores e validações.
// Todas as datas do sistema trafegam como string ISO "YYYY-MM-DD" para evitar
// distorções de fuso horário. Objetos Date são criados sempre ao meio-dia local.

export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ---------------------------------------------------------------- datas -- */

export function toDate(iso) {
  if (iso instanceof Date) return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate(), 12);
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12);
}

export function iso(date) {
  const d = date instanceof Date ? date : toDate(date);
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const hoje = () => iso(new Date());

export function addDays(base, n) {
  const d = toDate(base);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function addMonths(base, n) {
  const d = toDate(base);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(dia, diasNoMes(d.getFullYear(), d.getMonth())));
  return iso(d);
}

export const diasNoMes = (ano, mes) => new Date(ano, mes + 1, 0).getDate();

export function diffDias(a, b) {
  const d1 = toDate(a), d2 = toDate(b);
  if (!d1 || !d2) return 0;
  return Math.round((d2 - d1) / 86400000);
}

export const isFimDeSemana = (d) => [0, 6].includes(toDate(d).getDay());

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DIAS_SEMANA_CURTO = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

export function fmtData(v) {
  if (!v) return '—';
  const d = toDate(v);
  return d ? d.toLocaleDateString('pt-BR') : '—';
}

export function fmtDataHora(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDataExtenso(v) {
  const d = toDate(v);
  if (!d) return '—';
  return `${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
}

/** Texto relativo ao dia de hoje: "vence hoje", "em 3 dias", "vencido há 2 dias". */
export function humanizarPrazo(dataAlvo, ref = hoje()) {
  const n = diffDias(ref, dataAlvo);
  if (n === 0) return 'vence hoje';
  if (n === 1) return 'vence amanhã';
  if (n > 1) return `em ${n} dias`;
  if (n === -1) return 'vencido ontem';
  return `vencido há ${Math.abs(n)} dias`;
}

/* ----------------------------------------------------------- formatação -- */

export const fmtMoeda = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmtDocumento(v) {
  const s = String(v || '').replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '—';
}

export function fmtTelefone(v) {
  const s = String(v || '').replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v || '—';
}

/* ------------------------------------------------------- número do CNJ --- */

/** Normaliza para os 20 dígitos do padrão CNJ. */
export const cnjDigitos = (v) => String(v || '').replace(/\D/g, '').slice(0, 20);

export function fmtCNJ(v) {
  const s = cnjDigitos(v);
  if (s.length !== 20) return v || '—';
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`;
}

/**
 * Valida o número CNJ (Res. CNJ 65/2008) conferindo o dígito verificador
 * pelo módulo 97 base 10 (ISO 7064).
 */
export function validarCNJ(v) {
  const s = cnjDigitos(v);
  if (s.length !== 20) return { valido: false, motivo: 'O número deve conter 20 dígitos.' };
  const nnnnnnn = s.slice(0, 7), dd = s.slice(7, 9), aaaa = s.slice(9, 13);
  const j = s.slice(13, 14), tr = s.slice(14, 16), oooo = s.slice(16, 20);
  const base = `${nnnnnnn}${aaaa}${j}${tr}${oooo}00`;
  let resto = 0;
  for (const ch of base) resto = (resto * 10 + Number(ch)) % 97;
  const dv = String(98 - resto).padStart(2, '0');
  return dv === dd
    ? { valido: true }
    : { valido: false, motivo: `Dígito verificador incompatível (esperado ${dv}).` };
}

/* ---------------------------------------------------------------- texto -- */

export const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const truncar = (s, n = 120) =>
  String(s ?? '').length > n ? `${String(s).slice(0, n).trim()}…` : String(s ?? '');

export const pluralizar = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`;

export const agrupar = (lista, chave) => lista.reduce((acc, item) => {
  const k = typeof chave === 'function' ? chave(item) : item[chave];
  (acc[k] ||= []).push(item);
  return acc;
}, {});

export const ordenarPor = (lista, ...campos) => [...lista].sort((a, b) => {
  for (const c of campos) {
    const [campo, dir = 'asc'] = String(c).split(':');
    const va = a[campo] ?? '', vb = b[campo] ?? '';
    if (va === vb) continue;
    return (va > vb ? 1 : -1) * (dir === 'desc' ? -1 : 1);
  }
  return 0;
});

export const debounce = (fn, ms = 220) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
