// Ponte de consultas na própria origem.
//
// Os serviços públicos do CNJ não autorizam chamada vinda de outra origem, e o
// navegador bloqueia antes mesmo de sair. Quando a hospedagem oferece repasse
// na mesma origem — funções no Vercel, ou o servidor próprio do escritório —
// a consulta passa por ele e funciona.
//
// A sonda roda uma vez na abertura do sistema. Sem ponte, as telas de consulta
// explicam o motivo em vez de falhar em silêncio.

let estado = null;
let regiao = null;

export const pontePronta = () => estado !== null;
export const ponteDisponivel = () => estado === true;
/** Região em que a ponte executa. O CNJ só atende requisição vinda do Brasil. */
export const regiaoDaPonte = () => regiao;

/** Pergunta à origem se há repasse disponível. Nunca lança. */
export async function detectarPonte({ tempoLimite = 4000 } = {}) {
  if (estado !== null) return estado;
  try {
    const controle = new AbortController();
    const corte = setTimeout(() => controle.abort(), tempoLimite);
    const r = await fetch('/api/ponte', { signal: controle.signal, cache: 'no-store' });
    clearTimeout(corte);
    const corpo = r.ok ? await r.json().catch(() => null) : null;
    estado = corpo?.ok === true;
    regiao = corpo?.regiao || null;
  } catch {
    estado = false;
  }
  return estado;
}

/** Usado apenas pelos testes, para exercitar os dois cenários. */
export function definirPonte(valor, regiaoInformada = null) {
  estado = valor;
  regiao = regiaoInformada;
}
