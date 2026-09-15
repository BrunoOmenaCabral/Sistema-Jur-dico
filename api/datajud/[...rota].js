// Repasse da consulta processual ao DataJud, base pública do CNJ.
//
// O serviço não autoriza chamada de outra origem, então o navegador sozinho
// não o alcança. Aqui a requisição parte do servidor, sem esse obstáculo.
//
// Nada é gravado: o repasse é somente de leitura, usa a chave pública do CNJ
// e deixa passar apenas o índice do tribunal e o número do processo.

const BASE = (process.env.DATAJUD_BASE || 'https://api-publica.datajud.cnj.jus.br')
  .replace(/\/$/, '');
const CHAVE = process.env.DATAJUD_CHAVE
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });

  const partes = [].concat(req.query?.rota || []);
  const indice = String(partes[0] || '');
  if (!/^api_publica_[a-z0-9]+$/.test(indice)) {
    return res.status(400).json({ erro: 'Índice de tribunal inválido.' });
  }

  const corpo = typeof req.body === 'string' ? seguroJSON(req.body) : (req.body || {});
  const numero = String(corpo?.query?.match?.numeroProcesso || '').replace(/\D/g, '');
  if (numero.length !== 20) {
    return res.status(400).json({ erro: 'Informe o número CNJ com 20 dígitos.' });
  }

  try {
    const externa = await fetch(`${BASE}/${indice}/_search`, {
      method: 'POST',
      headers: { Authorization: `APIKey ${CHAVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { match: { numeroProcesso: numero } }, size: 10 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!externa.ok) {
      return res.status(externa.status === 404 ? 404 : 502)
        .json({ erro: `O DataJud respondeu ${externa.status}.` });
    }
    return res.status(200).json(await externa.json());
  } catch (e) {
    return res.status(504).json({ erro: `Consulta ao DataJud não concluída: ${e.message}` });
  }
};

function seguroJSON(texto) {
  try { return JSON.parse(texto); } catch { return {}; }
}
