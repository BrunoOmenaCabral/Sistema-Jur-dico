// Sonda da ponte de consultas.
//
// A aplicação pergunta aqui se a origem em que está hospedada oferece repasse
// para os serviços públicos do CNJ. Havendo resposta, ela deixa de tentar a
// chamada direta, que o navegador bloqueia por política de origem.

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    servicos: ["datajud", "djen", "pje"],
    // O serviço de comunicações do CNJ só atende acesso originado do Brasil.
    // Saber de onde a função executa torna o diagnóstico imediato.
    regiao: process.env.VERCEL_REGION || null,
  });
};
