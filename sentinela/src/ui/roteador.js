// Roteador por hash: #/modulo/parametro. Sem dependências externas.

const rotas = new Map();
let aoNavegar = null;
let alvoAtual = null;

export const registrar = (nome, render) => rotas.set(nome, render);
export const aoTrocarRota = (fn) => { aoNavegar = fn; };

export function rotaAtual() {
  const bruto = location.hash.replace(/^#\/?/, '');
  const [nome = 'dashboard', ...resto] = bruto.split('/').filter(Boolean);
  return { nome, params: resto, consulta: new URLSearchParams(location.search) };
}

export const ir = (rota) => { location.hash = rota.startsWith('#') ? rota : `#/${rota}`; };

export async function renderizar(alvo = alvoAtual) {
  alvoAtual = alvo;
  const { nome, params } = rotaAtual();
  const render = rotas.get(nome) || rotas.get('nao-encontrada');
  alvo.innerHTML = '';
  try {
    const saida = await render({ params, alvo });
    if (typeof saida === 'string') alvo.innerHTML = saida;
    else if (saida) alvo.appendChild(saida);
  } catch (e) {
    console.error(e);
    alvo.innerHTML = `<div class="aviso aviso--alerta">Não foi possível abrir esta tela: ${e.message}</div>`;
  }
  aoNavegar?.(nome, params);
  window.scrollTo({ top: 0 });
}

/** Redesenha a tela atual sem recarregar a página. */
export const recarregar = () => renderizar(alvoAtual);

export function iniciarRoteador(alvo) {
  window.addEventListener('hashchange', () => renderizar(alvo));
  if (!location.hash) location.hash = '#/dashboard';
  renderizar(alvo);
}
