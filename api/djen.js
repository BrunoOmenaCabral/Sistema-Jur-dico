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

  try {
    const externa = await fetch(`${BASE}/comunicacao?${parametros}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!externa.ok) {
      return res.status(502).json({ erro: `O serviço do CNJ respondeu ${externa.status}.` });
    }
    return res.status(200).json(await externa.json());
  } catch (e) {
    return res.status(504).json({ erro: `Consulta ao CNJ não concluída: ${e.message}` });
  }
};
