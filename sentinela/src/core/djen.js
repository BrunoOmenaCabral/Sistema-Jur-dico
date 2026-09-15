// Cliente da API pública de comunicações processuais do CNJ.
//
// O Diário de Justiça Eletrônico Nacional publica, em endereço aberto e sem
// autenticação, as citações e intimações de todos os tribunais integrados.
// A consulta aceita a inscrição na OAB, e é daí que o sistema descobre em
// quais processos o advogado atua, sem certificado digital.
//
// Endereço e parâmetros conforme a especificação do CNJ:
// GET /api/v1/comunicacao?numeroOab&ufOab&nomeAdvogado&nomeParte
//                        &numeroProcesso&dataDisponibilizacaoInicio&dataDisponibilizacaoFim
//
// Duas limitações conhecidas, tratadas explicitamente:
//  - o serviço responde 403 a requisição vinda de fora do Brasil;
//  - sendo página estática, o navegador só conclui a chamada se o CNJ
//    autorizar a origem. Havendo backend próprio, a consulta passa por ele.

import { db, modoAtual } from './store.js';
import { ponteDisponivel, regiaoDaPonte } from './ponte.js';
import { cnjDigitos, fmtCNJ, iso, hoje, addDays } from './util.js';

export const BASE_PADRAO = 'https://comunicaapi.pje.jus.br/api/v1';

/**
 * Endereço em uso, na ordem: o configurado no escritório, o repasse do backend
 * próprio quando ele estiver atendendo, e por fim o serviço do CNJ direto.
 * Pelo backend não há obstáculo de origem nem bloqueio geográfico.
 */
export function baseEmUso() {
  const cfg = db.config().integracoes.tribunais || {};
  const informado = cfg.base || (cfg.ativo ? cfg.provedor : '');
  if (informado) return String(informado).replace(/\/$/, '');
  // Servidor próprio ou ponte da hospedagem: ambos repassam na mesma origem.
  if (modoAtual() === 'servidor' || ponteDisponivel()) return '/api/djen';
  return BASE_PADRAO;
}

const UFS = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
  'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']);

/**
 * Lê uma inscrição na OAB escrita de qualquer forma usual — "OAB/PE 12345",
 * "12345/PE", "PE 12345" — e devolve número e seccional separados.
 */
export function parsearOAB(texto) {
  const bruto = String(texto || '').toUpperCase();
  const uf = (bruto.match(/\b([A-Z]{2})\b/g) || []).find((s) => UFS.has(s)) || '';
  const numero = (bruto.match(/\d{2,7}/) || [''])[0];
  return numero && uf ? { numero, uf } : null;
}

/**
 * Consulta as comunicações de um advogado em um intervalo de datas.
 *
 * @returns {Promise<{ok:boolean, comunicacoes:Array, motivo:string|null, total:number}>}
 */
export async function consultarPorOAB({ numeroOab, ufOab, de, ate, sinal = null }) {
  const numero = String(numeroOab || '').replace(/\D/g, '');
  const uf = String(ufOab || '').toUpperCase();
  if (!numero) return falha('Informe o número de inscrição na OAB.');
  if (!UFS.has(uf)) return falha('Informe a seccional da OAB.');

  const parametros = new URLSearchParams({
    numeroOab: numero,
    ufOab: uf,
    dataDisponibilizacaoInicio: de || addDays(hoje(), -180),
    dataDisponibilizacaoFim: ate || hoje(),
    // Não constam da especificação, mas o serviço os aceita e amplia a página.
    pagina: '1',
    itensPorPagina: '50',
  });

  return requisitar(parametros, sinal);
}

/** Uma requisição ao serviço, com o tratamento de falha que ele exige. */
async function requisitar(parametros, sinal) {
  let resposta;
  try {
    // Pelo repasse o caminho é a própria rota; direto, é o recurso do CNJ.
    const base = baseEmUso();
    const endereco = base.startsWith('/api/')
      ? `${base}?${parametros}`
      : `${base}/comunicacao?${parametros}`;
    resposta = await fetch(endereco, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: sinal,
    });
  } catch (e) {
    // fetch só lança assim por rede indisponível ou origem não autorizada.
    return falha(ponteDisponivel()
      ? `A ponte desta hospedagem não respondeu à consulta ao DJEN. Detalhe: ${e.message}`
      : 'Esta hospedagem não repassa consultas, e o serviço do CNJ não autoriza chamada vinda '
        + 'de outra origem: o navegador bloqueia antes de sair. Abra o sistema pelo endereço que '
        + 'tem a ponte de consultas, ou rode com o servidor próprio. Enquanto isso, use a '
        + `importação da lista exportada pelo tribunal. Detalhe técnico: ${e.message}`);
  }

  if (resposta.status === 403) {
    const onde = (await resposta.json().catch(() => null))?.regiao || regiaoDaPonte();
    return falha('O serviço do CNJ recusou a consulta (403): ele atende apenas acesso originado '
      + 'do Brasil. '
      + (onde
        ? `A consulta partiu da região ${onde}. `
          + (onde.startsWith('gru') ? 'A região está no Brasil, então o motivo é outro.'
            : 'Configure a hospedagem para executar em São Paulo (gru1).')
        : 'Verifique de onde a hospedagem executa a consulta.'));
  }
  if (!resposta.ok) {
    // O repasse devolve o status e o texto que vieram do CNJ. Mostrar o status
    // da ponte no lugar do original esconderia a origem do problema.
    const corpo = await resposta.json().catch(() => null);
    const origem = corpo?.origem || corpo?.status;
    const detalhe = [corpo?.erro, corpo?.detalhe].filter(Boolean).join(' ').slice(0, 300);
    return falha(origem && origem !== resposta.status
      ? `O serviço do CNJ respondeu ${origem}. ${detalhe}`
      : `A consulta falhou com ${resposta.status}. ${detalhe || 'Tente novamente em instantes.'}`,
    { status: resposta.status, origem: origem || null });
  }

  let dados;
  try { dados = await resposta.json(); }
  catch { return falha('O serviço do CNJ devolveu resposta ilegível.'); }

  const itens = Array.isArray(dados?.items) ? dados.items : [];
  return { ok: true, motivo: null, total: Number(dados?.count ?? itens.length), comunicacoes: itens };
}

const falha = (motivo, extra = {}) => ({ ok: false, motivo, comunicacoes: [], total: 0, ...extra });

/**
 * Consulta as comunicações de um processo específico.
 *
 * Serve para recuperar o teor dos atos: o DataJud informa que houve sentença,
 * mas não o que ela diz. O texto está na intimação publicada no diário.
 */
export async function consultarPorProcesso({ numeroProcesso, de = null, ate = null, sinal = null }) {
  const numero = cnjDigitos(numeroProcesso);
  if (numero.length !== 20) return falha('Número CNJ inválido.');

  // Janela larga demais costuma derrubar o serviço: dois anos é o teto.
  let inicio = de;
  if (inicio && ate) {
    const limite = addDays(ate, -730);
    if (inicio < limite) inicio = limite;
  }

  // As tentativas vão da mais restrita à mais ampla. O serviço é sensível ao
  // formato do número e ao intervalo, e nem todo tribunal responde ao mesmo
  // conjunto de parâmetros. Vazio não é erro: é motivo para tentar de outro
  // jeito antes de concluir que não há nada.
  const tentativas = [];
  if (inicio || ate) {
    const comData = new URLSearchParams({ numeroProcesso: numero, itensPorPagina: '50' });
    if (inicio) comData.set('dataDisponibilizacaoInicio', inicio);
    if (ate) comData.set('dataDisponibilizacaoFim', ate);
    tentativas.push(comData);
  }
  tentativas.push(new URLSearchParams({ numeroProcesso: numero, itensPorPagina: '50' }));
  tentativas.push(new URLSearchParams({ numeroProcesso: fmtCNJ(numero), itensPorPagina: '50' }));

  let ultima = falha('Nenhuma tentativa realizada.');
  let primeiroErro = null;
  for (const [i, parametros] of tentativas.entries()) {
    // O serviço não gosta de rajada: um respiro entre tentativas o estabiliza.
    if (i) await new Promise((r) => setTimeout(r, 600));
    const r = await requisitar(parametros, sinal);
    if (r.ok && r.comunicacoes.length) return { ...r, consulta: parametros.toString() };
    if (r.ok) { ultima = { ...r, consulta: parametros.toString() }; continue; }

    primeiroErro ||= r;
    // Recusa do pedido não muda com repetição; só falha do serviço merece outra.
    if (r.status && r.status >= 400 && r.status < 500) break;
  }
  return ultima.ok ? ultima : (primeiroErro || ultima);
}

/**
 * Converte uma comunicação do DJEN em publicação do sistema, no formato que
 * a fila de conferência e o motor de prazos já entendem.
 */
export function comunicacaoComoPublicacao(item) {
  return {
    numeroCNJ: cnjDigitos(item.numero_processo || item.numeroprocessocommascara),
    dataDisponibilizacao: normalizarData(item.data_disponibilizacao || item.datadisponibilizacao),
    dataPublicacao: null,
    diario: `DJEN — ${item.siglaTribunal || 'tribunal não informado'}`,
    conteudo: item.texto || '',
    origem: 'DJEN',
    tipoComunicacao: item.tipoComunicacao || '',
    orgao: item.nomeOrgao || '',
    link: item.link || '',
  };
}

/**
 * Agrupa as comunicações por processo.
 *
 * Processo que recebeu comunicação no período está em curso: é esse o critério
 * de atividade, já que o DJEN informa atos, não situação processual. O texto
 * da comunicação mais recente é preservado para que o filtro de arquivamento
 * definitivo possa examiná-lo.
 */
export function agruparEmProcessos(comunicacoes) {
  const mapa = new Map();

  for (const item of comunicacoes) {
    const numero = cnjDigitos(item.numero_processo || item.numeroprocessocommascara);
    if (numero.length !== 20) continue;
    const data = normalizarData(item.data_disponibilizacao || item.datadisponibilizacao);
    const atual = mapa.get(numero);

    if (!atual) {
      mapa.set(numero, {
        numeroCNJ: numero,
        tribunal: item.siglaTribunal || '',
        vara: item.nomeOrgao || '',
        classe: item.nomeClasse || '',
        ultimaData: data,
        ultimoMovimento: item.texto || '',
        comunicacoes: 1,
      });
      continue;
    }
    atual.comunicacoes += 1;
    if (data && (!atual.ultimaData || data > atual.ultimaData)) {
      atual.ultimaData = data;
      atual.ultimoMovimento = item.texto || '';
      atual.vara = item.nomeOrgao || atual.vara;
      atual.classe = item.nomeClasse || atual.classe;
    }
  }

  return [...mapa.values()].sort((a, b) => String(b.ultimaData).localeCompare(String(a.ultimaData)));
}

/** O serviço devolve a data em formatos distintos conforme o tribunal. */
function normalizarData(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return iso(new Date(texto)) || null;
}
