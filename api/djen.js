// Repasse da consulta de comunicações ao DJEN, do CNJ.
//
// Dois obstáculos justificam o repasse: o serviço não autoriza chamada de
// outra origem, e recusa acesso vindo de fora do Brasil. Partindo do servidor,
// nenhum dos dois se aplica quando a hospedagem está no país.
//
// GET /api/djen?numeroOab=...&ufOab=...&dataDisponibilizacaoInicio=...

const BASE = (process.env.DJEN_BASE || 'https://comunicaapi.pje.jus.br/api/v1').replace(/\/$/, '');

const PERMITIDOS = ['numeroOab', 'ufOab', 'nomeAdvogado', 'nomeParte', 'numeroProcesso',
  'dataDisponibilizacaoInicio', 'dataDisponibilizacaoFim', 'pagina', 'itensPorPagina'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET.' });

  const parametros = new URLSearchParams();
  for (const chave of PERMITIDOS) {
    const valor = req.query?.[chave];
    if (valor) parametros.set(chave, String(valor).slice(0, 64));
  }
  if (!parametros.get('numeroOab') && !parametros.get('numeroProcesso')) {
    return res.status(400).json({ erro: 'Informe a OAB ou o número do processo.' });
  }

  // Instabilidade momentânea é comum neste serviço. Uma segunda tentativa,
  // após breve espera, resolve boa parte dos casos sem incomodar quem usa.
  let ultima = null;
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    if (tentativa) await new Promise((r) => setTimeout(r, 700));
    try {
      const externa = await fetch(`${BASE}/comunicacao?${parametros}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      const texto = await externa.text();
      if (externa.ok) return res.status(200).json(seguroJSON(texto));

      ultima = {
        status: externa.status,
        erro: `O serviço do CNJ respondeu ${externa.status}.`,
        origem: externa.status,
        regiao: process.env.VERCEL_REGION || null,
        consulta: parametros.toString(),
        detalhe: texto.slice(0, 400),
      };
      // Erro do pedido não muda com repetição; só vale repetir falha do serviço.
      if (externa.status < 500) break;
    } catch (e) {
      ultima = { status: 504, erro: `Consulta ao CNJ não concluída: ${e.message}`,
        regiao: process.env.VERCEL_REGION || null, consulta: parametros.toString() };
    }
  }

  // O status do CNJ atravessa, para que a origem do problema fique visível.
  const { status, ...corpo } = ultima;
  return res.status(status >= 400 && status < 500 ? status : 502).json(corpo);
};

function seguroJSON(texto) {
  try { return JSON.parse(texto); } catch { return {}; }
}
