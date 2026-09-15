// Repasse da consulta processual ao DataJud, base pública do CNJ.
//
// O serviço não autoriza chamada de outra origem, então o navegador sozinho
// não o alcança. Aqui a requisição parte do servidor, sem esse obstáculo.
//
// Arquivo plano, e não rota curinga: o roteamento por diretório com curinga
// não se mostrou confiável na hospedagem, e o índice do tribunal cabe bem no
// corpo da requisição.
//
// POST /api/datajud  { "indice": "tjpe", "numeroProcesso": "<20 dígitos>" }

const BASE = (process.env.DATAJUD_BASE || 'https://api-publica.datajud.cnj.jus.br')
  .replace(/\/$/, '');
const CHAVE = process.env.DATAJUD_CHAVE
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });

  const corpo = typeof req.body === 'string' ? seguroJSON(req.body) : (req.body || {});
  const indice = String(corpo.indice || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const numero = String(corpo.numeroProcesso || '').replace(/\D/g, '');

  if (!indice) return res.status(400).json({ erro: 'Informe o índice do tribunal.' });
  if (numero.length !== 20) {
    return res.status(400).json({ erro: 'Informe o número CNJ com 20 dígitos.' });
  }

  try {
    const externa = await fetch(`${BASE}/api_publica_${indice}/_search`, {
      method: 'POST',
      headers: { Authorization: `APIKey ${CHAVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { match: { numeroProcesso: numero } }, size: 10 }),
      signal: AbortSignal.timeout(20000),
    });
    const texto = await externa.text();
    if (!externa.ok) {
      return res.status(externa.status === 404 ? 404 : 502).json({
        erro: `O DataJud respondeu ${externa.status} para o índice api_publica_${indice}.`,
        detalhe: texto.slice(0, 300),
      });
    }
    return res.status(200).json(seguroJSON(texto));
  } catch (e) {
    return res.status(504).json({ erro: `Consulta ao DataJud não concluída: ${e.message}` });
  }
};

function seguroJSON(texto) {
  try { return JSON.parse(texto); } catch { return {}; }
}
