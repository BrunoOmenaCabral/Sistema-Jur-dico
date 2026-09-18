// Consulta pública do PJe, a fonte tempestiva do próprio tribunal.
//
// A base do CNJ é alimentada em lotes e chega a ficar semanas atrás do que
// consta nos autos. A consulta pública do PJe mostra o andamento no momento em
// que é pedida, e é por ela que se alcança a juntada de ontem.
//
// O PJe é aplicação JSF: a busca exige a sessão da página, o identificador do
// comando de pesquisa e o envio do formulário inteiro. Esse encadeamento fica
// no repasse do servidor, porque depende de cookie e de três requisições
// seguidas. Aqui se lê o que ele devolve.

import { cnjDigitos, fmtCNJ } from './util.js';
import { ponteDisponivel } from './ponte.js';
import { modoAtual } from './store.js';

/** Tribunais cuja consulta pública já foi verificada. */
export const PJE_TRIBUNAIS = {
  tjpe: { rotulo: 'TJPE', graus: ['1g', '2g'] },
};

/** O código do tribunal no número CNJ: 8.17 é a Justiça Estadual de Pernambuco. */
export function tribunalPJe({ numeroCNJ, tribunal = '' }) {
  const sigla = String(tribunal || '').trim().toLowerCase();
  if (PJE_TRIBUNAIS[sigla]) return sigla;
  const d = cnjDigitos(numeroCNJ);
  if (d.length === 20 && d.slice(13, 14) === '8' && d.slice(14, 16) === '17') return 'tjpe';
  return null;
}

const falha = (motivo, extra = {}) => ({ ok: false, motivo, movimentos: [], ...extra });

/**
 * Pede ao repasse o detalhe do processo na consulta pública.
 *
 * Sem repasse não há como consultar: a página do tribunal não autoriza chamada
 * vinda de outra origem, e a consulta depende de sessão própria.
 */
export async function consultarPJe({ numeroCNJ, tribunal = '', grau = null, sinal = null }) {
  // Sem grau declarado, procura-se no primeiro e, não achando, no segundo: o
  // agravo de instrumento e a apelação correm no segundo grau.
  if (!grau) {
    const primeira = await consultarPJe({ numeroCNJ, tribunal, grau: '1g', sinal });
    if (primeira.ok || !primeira.semRegistro) return primeira;
    const segunda = await consultarPJe({ numeroCNJ, tribunal, grau: '2g', sinal });
    return segunda.ok ? segunda : primeira;
  }
  return consultarGrauPJe({ numeroCNJ, tribunal, grau, sinal });
}

async function consultarGrauPJe({ numeroCNJ, tribunal = '', grau = '1g', sinal = null }) {
  const numero = cnjDigitos(numeroCNJ);
  if (numero.length !== 20) return falha('Número CNJ inválido.');

  const alvo = tribunalPJe({ numeroCNJ: numero, tribunal });
  if (!alvo) {
    return falha('A consulta pública direta ao tribunal ainda só está disponível para o TJPE.',
      { indisponivel: true });
  }
  if (modoAtual() !== 'servidor' && !ponteDisponivel()) {
    return falha('Esta hospedagem não repassa consultas ao tribunal. Abra o sistema pelo endereço '
      + 'que tem a ponte de consultas.', { indisponivel: true });
  }

  let resposta;
  try {
    resposta = await fetch(`/api/pje?tribunal=${alvo}&grau=${grau}&numeroProcesso=${numero}`,
      { headers: { Accept: 'application/json' }, signal: sinal });
  } catch (e) {
    return falha(`A ponte não respondeu à consulta ao ${alvo.toUpperCase()}. Detalhe: ${e.message}`);
  }

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok || !corpo?.html) {
    return falha(corpo?.erro || `A consulta ao tribunal respondeu ${resposta.status}.`,
      { detalhe: corpo?.detalhe || '' });
  }
  if (corpo.encontrados === 0) {
    return falha('O tribunal não encontrou este processo na consulta pública. Processo em segredo '
      + 'de justiça não é publicado.', { semRegistro: true });
  }

  const lido = lerDetalhePJe(corpo.html);
  return {
    ok: true,
    motivo: null,
    fonte: `Consulta pública ${alvo.toUpperCase()} (PJe ${grau === '2g' ? '2º' : '1º'} grau)`,
    numeroCNJ: fmtCNJ(numero),
    ...lido,
  };
}

/* ------------------------------------------------- leitura da página ----- */

const semTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ');

/** Entidades do HTML do PJe, que vem em latin-1 convertido. */
function texto(bruto) {
  return semTags(bruto)
    .replace(/&([a-zA-Z]+);|&#(\d+);/g, (todo, nome, numero) => {
      if (numero) return String.fromCharCode(Number(numero));
      const t = { aacute: 'á', acirc: 'â', atilde: 'ã', agrave: 'à', ccedil: 'ç', eacute: 'é',
        ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', uuml: 'ü',
        Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Ccedil: 'Ç', Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í',
        Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', nbsp: ' ', amp: '&', quot: '"',
        lt: '<', gt: '>', middot: '·', ordm: 'º', ordf: 'ª' };
      return t[nome] ?? todo;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const paraISO = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(d || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * Extrai da página de detalhe as movimentações e o total informado pelo
 * tribunal. Cada linha vem como "DD/MM/AAAA HH:MM:SS - Título do movimento",
 * e a coluna ao lado traz o documento, quando é público.
 */
export function lerDetalhePJe(html) {
  const bruto = String(html || '');
  const corpo = /<tbody id="[^"]*processoEvento:tb">([\s\S]*?)<\/tbody>/.exec(bruto);
  const linhas = corpo ? corpo[1].split(/<tr[^>]*>/).slice(1) : [];

  const movimentos = [];
  for (const linha of linhas) {
    const celula = /<span id="[^"]*processoEvento:\d+:j_id\d+"[^>]*>([\s\S]*?)<\/span>/.exec(linha);
    if (!celula) continue;
    const conteudo = texto(celula[1]);
    const m = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/.exec(conteudo);
    if (!m) continue;

    const documento = /documentoSemLoginHTML\.seam\?ca=([0-9a-f]+)/i.exec(linha);
    movimentos.push({
      data: paraISO(m[1]),
      hora: m[2],
      titulo: m[3].trim(),
      documento: documento ? documento[1] : null,
    });
  }

  const total = /([\d.]+)\s*resultados? encontrados?/.exec(texto(bruto.slice(bruto.indexOf('processoEvento:tb'))));
  return {
    movimentos,
    total: total ? Number(total[1].replace(/\./g, '')) : movimentos.length,
    // A consulta pública mostra uma página por vez, da mais recente para a mais
    // antiga. O que não coube aqui continua vindo da base do CNJ.
    parcial: Boolean(total && Number(total[1].replace(/\./g, '')) > movimentos.length),
  };
}

/** Endereço público do documento do ato, quando o tribunal o disponibiliza. */
export const documentoPJe = (tribunal, grau, ca) =>
  `https://pje.${tribunal}.jus.br/${grau}/ConsultaPublica/DetalheProcessoConsultaPublica`
  + `/documentoSemLoginHTML.seam?ca=${ca}`;

/**
 * Converte o movimento lido na consulta pública ao formato da linha do tempo.
 *
 * A chave externa carrega data, hora e título: na consulta pública não há
 * código de movimento, e é a hora que distingue duas juntadas do mesmo dia.
 */
export function movimentoPJeComoRegistro(movimento, { tribunal = 'tjpe', grau = '1g' } = {}) {
  const assinatura = `${movimento.data}T${movimento.hora}:${movimento.titulo}`
    .toLowerCase().replace(/\s+/g, ' ');
  return {
    data: movimento.data,
    titulo: movimento.titulo,
    codigo: null,
    descricao: `${movimento.hora} — consulta pública do tribunal`,
    origem: 'andamento processual',
    grau: grau === '2g' ? 'G2' : 'G1',
    fonte: `PJe ${tribunal.toUpperCase()}`,
    linkTeor: movimento.documento ? documentoPJe(tribunal, grau, movimento.documento) : null,
    fonteTeor: movimento.documento ? 'consulta pública do tribunal' : null,
    chaveExterna: `pje:${tribunal}:${grau}:${assinatura}`,
  };
}
