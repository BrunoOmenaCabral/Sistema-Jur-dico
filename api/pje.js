// Repasse da consulta pública do PJe na hospedagem antiga.
//
// A cadeia de requisições vive em servidor/src/pje.js, compartilhada com o
// servidor próprio: manter duas cópias de um acordo tão sensível à forma da
// página do tribunal seria garantir que uma delas envelheça em silêncio.
//
// GET /api/pje?tribunal=tjpe&grau=1g&numeroProcesso=00071378820268172001

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET.' });

  const { consultarPJe } = await import('../servidor/src/pje.js');
  const { status, corpo } = await consultarPJe({
    tribunal: req.query?.tribunal,
    grau: req.query?.grau,
    numeroProcesso: req.query?.numeroProcesso,
    regiao: process.env.VERCEL_REGION || null,
  });
  return res.status(status).json(corpo);
};
