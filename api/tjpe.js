// Repasse da consulta processual unificada do TJPE.
//
// A base pública do CNJ é alimentada pelos tribunais em lotes, com dias de
// atraso, e por isso não serve ao acompanhamento do que ocorreu ontem. A
// consulta do próprio tribunal é a fonte tempestiva, mas não autoriza chamada
// vinda de outra origem e recusa acesso de fora do país. Partindo do servidor
// em São Paulo, nenhum dos dois obstáculos se aplica.
//
// GET /api/tjpe?numeroProcesso=00000000000000000000
// GET /api/tjpe?diagnostico=1[&caminho=...]  — devolve o que o tribunal
//   respondeu, para que a leitura da página seja escrita sobre o retorno real.

const BASE = (process.env.TJPE_BASE
  || 'https://srv03.tjpe.jus.br/consultaprocessualunificada').replace(/\/$/, '');

// Navegador comum: a consulta é pública, mas a borda do tribunal recusa cliente
// que não se identifica.
const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

// Só caminhos da própria consulta: a rota não serve de proxy para outra coisa.
const seguro = (caminho) => /^[a-zA-Z0-9/_.-]{0,120}$/.test(caminho || '');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Use GET.' });

  const numero = String(req.query?.numeroProcesso || '').replace(/\D/g, '');
  const diagnostico = String(req.query?.diagnostico || '') === '1';
  const caminho = String(req.query?.caminho || '');
  if (!seguro(caminho)) return res.status(400).json({ erro: 'Caminho inválido.' });
  if (!diagnostico && numero.length !== 20) {
    return res.status(400).json({ erro: 'Informe o número CNJ com 20 dígitos.' });
  }

  const alvo = `${BASE}${caminho ? `/${caminho.replace(/^\//, '')}` : '/'}`
    + (numero ? `${caminho.includes('?') ? '&' : '?'}numeroProcesso=${numero}` : '');

  let externa;
  let corpo = '';
  try {
    externa = await fetch(alvo, { headers: CABECALHOS, redirect: 'follow',
      signal: AbortSignal.timeout(25000) });
    corpo = await externa.text();
  } catch (e) {
    return res.status(502).json({
      erro: 'O sistema do TJPE não respondeu.',
      detalhe: e.message,
      regiao: process.env.VERCEL_REGION || null,
    });
  }

  if (diagnostico) {
    // O retorno bruto é o que permite escrever a leitura da página sem adivinhar.
    return res.status(200).json({
      url: alvo,
      status: externa.status,
      tipo: externa.headers.get('content-type') || '',
      tamanho: corpo.length,
      cookies: Boolean(externa.headers.get('set-cookie')),
      regiao: process.env.VERCEL_REGION || null,
      amostra: corpo.slice(0, 6000),
    });
  }

  if (!externa.ok) {
    return res.status(externa.status).json({
      erro: `A consulta do TJPE respondeu ${externa.status}.`,
      detalhe: corpo.slice(0, 300),
      regiao: process.env.VERCEL_REGION || null,
    });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(corpo);
};
