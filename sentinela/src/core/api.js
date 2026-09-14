// Cliente da API. Único ponto do navegador que fala com o servidor.

const CABECALHOS = { 'Content-Type': 'application/json', 'X-Requisicao': 'sentinela' };

async function requisicao(metodo, rota, corpo) {
  const resposta = await fetch(`/api${rota}`, {
    method: metodo,
    headers: CABECALHOS,
    credentials: 'same-origin',
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await resposta.json() : null;
  if (!resposta.ok) {
    const erro = new Error(dados?.erro || `Falha na comunicação (${resposta.status}).`);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

export const api = {
  /** Diz se há servidor atendendo nesta origem. */
  async disponivel() {
    try {
      const controle = new AbortController();
      const tempo = setTimeout(() => controle.abort(), 3000);
      const r = await fetch('/api/saude', { signal: controle.signal, credentials: 'same-origin' });
      clearTimeout(tempo);
      return r.ok;
    } catch { return false; }
  },

  entrar: (email, senha) => requisicao('POST', '/sessao', { email, senha }),
  sair: () => requisicao('DELETE', '/sessao'),
  sessao: () => requisicao('GET', '/sessao'),
  estado: (desde) => requisicao('GET', `/estado${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`),
  mutacoes: (mutacoes) => requisicao('POST', '/mutacoes', { mutacoes }),
  salvarConfiguracoes: (configuracoes) => requisicao('PUT', '/configuracoes', configuracoes),
  criarUsuario: (dados) => requisicao('POST', '/usuarios', dados),
  definirSenha: (usuarioId, senha) => requisicao('PUT', `/usuarios/${usuarioId}/senha`, { senha }),
};
