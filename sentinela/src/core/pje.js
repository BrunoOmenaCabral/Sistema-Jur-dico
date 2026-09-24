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

/**
 * Tribunais cuja consulta pública já foi verificada contra processo real.
 *
 * A chave é a sigla; `codigo` é o par segmento/tribunal do número CNJ, que é
 * como se descobre o foro a partir do próprio número. Só entram aqui os que
 * responderam à cadeia de requisições: instalação do PJe em outra variante
 * devolve a página, mas não a pesquisa, e prometer o que não se conferiu seria
 * pior do que dizer que não há.
 */
export const PJE_TRIBUNAIS = {
  tjpe: { rotulo: 'TJPE', codigo: '817', graus: ['1g', '2g'] },
  tjba: { rotulo: 'TJBA', codigo: '805', graus: ['1g'] },
  tjma: { rotulo: 'TJMA', codigo: '810', graus: ['1g'] },
  tjpb: { rotulo: 'TJPB', codigo: '815', graus: ['1g'] },
  tjmg: { rotulo: 'TJMG', codigo: '813', graus: ['1g'] },
  tjrj: { rotulo: 'TJRJ', codigo: '819', graus: ['1g', '2g'] },
  trf1: { rotulo: 'TRF1', codigo: '401', graus: ['1g'] },
};

/** O código do tribunal no número CNJ: 8.17 é a Justiça Estadual de Pernambuco. */
export function tribunalPJe({ numeroCNJ, tribunal = '' }) {
  const sigla = String(tribunal || '').trim().toLowerCase();
  if (PJE_TRIBUNAIS[sigla]) return sigla;
  const d = cnjDigitos(numeroCNJ);
  if (d.length !== 20) return null;
  const codigo = d.slice(13, 16);
  const achado = Object.entries(PJE_TRIBUNAIS).find(([, v]) => v.codigo === codigo);
  return achado ? achado[0] : null;
}

/** Graus que vale tentar no tribunal, para não pedir o que ele não serve. */
export const grausPJe = (sigla) => PJE_TRIBUNAIS[sigla]?.graus || ['1g'];

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
    const alvo = tribunalPJe({ numeroCNJ, tribunal });
    const graus = alvo ? grausPJe(alvo) : ['1g'];
    let ultima = null;
    for (const g of graus) {
      const r = await consultarPJe({ numeroCNJ, tribunal, grau: g, sinal });
      if (r.ok || !r.semRegistro) return r;
      ultima = ultima || r;
    }
    return ultima;
  }
  return consultarGrauPJe({ numeroCNJ, tribunal, grau, sinal });
}

async function consultarGrauPJe({ numeroCNJ, tribunal = '', grau = '1g', sinal = null }) {
  const numero = cnjDigitos(numeroCNJ);
  if (numero.length !== 20) return falha('Número CNJ inválido.');

  const alvo = tribunalPJe({ numeroCNJ: numero, tribunal });
  if (!alvo) {
    return falha('A consulta pública direta ainda não está mapeada para este tribunal. Cada um '
      + 'serve o PJe em uma variante, e o acordo precisa ser conferido um a um; o andamento vem '
      + 'do DataJud, que cobre todos mas anda dias atrás dos autos. Hoje há consulta direta em '
      + `${Object.values(PJE_TRIBUNAIS).map((v) => v.rotulo).join(', ')}.`,
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
/**
 * Código interno entre parênteses no fim — "(156)" — não é informação para o
 * cadastro. O parêntese vem às vezes sem fechar, porque a própria página corta
 * o assunto no meio.
 */
const semCodigo = (s) => String(s || '').replace(/\s*\(\d+\)?\s*$/, '').trim();

/**
 * Dados do processo, como o tribunal os apresenta.
 *
 * A página traz pares rótulo/valor; lê-se por rótulo, e não por posição, porque
 * a ordem muda conforme o que o processo tem preenchido.
 */
export function lerCapaPJe(html) {
  const bruto = String(html || '');
  const pares = new Map();
  const blocos = bruto.matchAll(
    /<div class="propertyView[^"]*">\s*<div class="name">([\s\S]*?)<\/div>\s*<div class="value[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g);
  for (const b of blocos) {
    const rotulo = texto(b[1]).replace(/:$/, '');
    if (rotulo) pares.set(rotulo.toLowerCase(), texto(b[2]));
  }

  // O órgão julgador vem em bloco sem rótulo, marcado em negrito, com o endereço
  // logo abaixo, dentro de outra divisão.
  const orgao = /<b>\s*(?:Órgão|&Oacute;rg&atilde;o)[\s\S]{0,20}?Julgador\s*<\/b>([\s\S]*?)<div/i
    .exec(bruto);

  const assunto = pares.get('assunto') || '';
  return {
    numeroCNJ: pares.get('número processo') || '',
    dataDistribuicao: paraISO(pares.get('data da distribuição')),
    classe: semCodigo(pares.get('classe judicial')),
    // O assunto vem em cadeia, do geral ao específico; o último é o que
    // identifica a causa.
    assunto: semCodigo(assunto.split(' - ').at(-1) || ''),
    assuntoCompleto: assunto,
    comarca: pares.get('jurisdição') || '',
    vara: orgao ? texto(orgao[1]) : '',
    processoReferencia: pares.get('processo referência') || '',
    ...lerPartesPJe(bruto),
  };
}

/** Primeira parte de cada polo: é quem o cadastro identifica. */
export function lerPartesPJe(html) {
  const bruto = String(html || '');
  const doPolo = (polo) => {
    const corpo = new RegExp(`<tbody id="[^"]*processoPartes${polo}ResumidoList:tb">([\\s\\S]*?)<\/tbody>`)
      .exec(bruto);
    if (!corpo) return '';
    const primeira = corpo[1].split(/<tr[^>]*>/).slice(1)[0] || '';
    // O nome vem antes do documento; o resto da célula é situação e estilo.
    return texto(primeira).split(/\s+-\s+(?:CPF|CNPJ)/)[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
  };
  return { poloAtivo: doPolo('PoloAtivo'), poloPassivo: doPolo('PoloPassivo') };
}

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
    capa: lerCapaPJe(bruto),
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
