// Repasse da consulta pública do PJe.
//
// A base do CNJ é alimentada pelos tribunais em lotes e fica dias ou semanas
// atrás do que consta nos autos. A consulta pública do PJe responde com o
// andamento do momento, e é ela que alcança a juntada de ontem.
//
// O PJe é aplicação JSF: a pesquisa só é aceita dentro da sessão da própria
// página, com o identificador do comando de pesquisa daquela renderização e o
// formulário inteiro. São três idas ao tribunal, encadeadas por cookie, e por
// isso ficam aqui, no servidor.
//
// Usado tanto pelo servidor próprio quanto pela função da hospedagem antiga:
// a cadeia é a mesma, só muda quem devolve a resposta.

const TRIBUNAIS = {
  tjpe: 'https://pje.tjpe.jus.br',
};
const GRAUS = ['1g', '2g'];

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)'
  + ' Chrome/140.0.0.0 Safari/537.36';

/** Número com a máscara: a consulta pública não aceita só os dígitos. */
const comMascara = (d) => `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}`
  + `.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;

/** Guarda os cookies entre as requisições, que é o que sustenta a sessão JSF. */
function jarra() {
  const cookies = new Map();
  return {
    guardar(resposta) {
      const brutos = resposta.headers.getSetCookie?.() || [];
      for (const c of brutos) {
        const [par] = c.split(';');
        const i = par.indexOf('=');
        if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
      }
    },
    cabecalho() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

/**
 * Texto da resposta na codificação que o tribunal declarou.
 *
 * O PJe serve ISO-8859-1 e, na própria página, anuncia UTF-8 na marcação. Vale
 * o cabeçalho: lendo como UTF-8, todo acento fora de entidade HTML vira
 * caractere inválido, e nome de parte e assunto chegam corrompidos.
 */
async function texto(resposta) {
  const tipo = resposta.headers.get('content-type') || '';
  const charset = (/charset=([^;\s]+)/i.exec(tipo)?.[1] || 'utf-8').toLowerCase();
  const bytes = await resposta.arrayBuffer();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Busca seguindo redirecionamento à mão, para não perder os cookies do caminho. */
async function ir(url, opcoes, pote, saltos = 5) {
  const resposta = await fetch(url, {
    ...opcoes,
    redirect: 'manual',
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9',
      ...(pote.cabecalho() ? { Cookie: pote.cabecalho() } : {}), ...(opcoes.headers || {}) },
    signal: AbortSignal.timeout(25000),
  });
  pote.guardar(resposta);
  const destino = resposta.headers.get('location');
  if (destino && resposta.status >= 300 && resposta.status < 400 && saltos > 0) {
    return ir(new URL(destino, url).toString(), { method: 'GET' }, pote, saltos - 1);
  }
  return resposta;
}

/**
 * Consulta pública do PJe: capa e movimentações do processo.
 *
 * @returns {Promise<{status:number, corpo:object}>} resposta pronta para servir.
 */
export async function consultarPJe({ tribunal: sigla, grau: grauBruto, numeroProcesso, regiao = null } = {}) {
  const tribunal = String(sigla || 'tjpe').toLowerCase();
  const grau = GRAUS.includes(String(grauBruto)) ? String(grauBruto) : '1g';
  const numero = String(numeroProcesso || '').replace(/\D/g, '');
  const base = TRIBUNAIS[tribunal];

  if (!base) return resposta(400, { erro: `Tribunal não atendido: ${tribunal}.` });
  if (numero.length !== 20) return resposta(400, { erro: 'Informe o número com 20 dígitos.' });

  const pote = jarra();
  const consulta = `${base}/${grau}/ConsultaPublica/listView.seam`;

  try {
    // 1. A página da consulta, que traz a sessão e o comando de pesquisa.
    const inicial = await ir(consulta, { method: 'GET' }, pote);
    const pagina = await texto(inicial);
    if (!inicial.ok) {
      return resposta(502, { erro: `O ${tribunal.toUpperCase()} respondeu `
        + `${inicial.status} à abertura da consulta.`, regiao });
    }

    const acao = /<form[^>]*name="fPP"[^>]*action="([^"]+)"/.exec(pagina);
    if (!acao) {
      return resposta(502, { erro: 'A página da consulta pública mudou de forma: '
        + 'o formulário de pesquisa não foi reconhecido.' });
    }
    // O ;jsessionid no caminho é recusado pela borda do tribunal; a sessão vai
    // pelo cookie.
    const enderecoPost = new URL(acao[1].replace(/;jsessionid=[^?]*/, ''), inicial.url || consulta);

    let comando = null;
    const roteiros = pagina.matchAll(/<script id="(fPP:j_id\d+)"[^>]*>([\s\S]{0,400})/g);
    for (const r of roteiros) {
      if (r[2].includes('executarPesquisa=function')) { comando = r[1]; break; }
    }
    if (!comando) {
      return resposta(502, { erro: 'A página da consulta pública mudou de forma: '
        + 'o comando de pesquisa não foi reconhecido.' });
    }

    const estado = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/.exec(pagina);
    const mes = `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`;

    const campos = new URLSearchParams();
    campos.set('AJAXREQUEST', '_viewRoot');
    campos.set('fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso',
      comMascara(numero));
    campos.set('mascaraProcessoReferenciaRadio', 'on');
    campos.set('fPP:j_id163:processoReferenciaInput', '');
    campos.set('fPP:dnp:nomeParte', '');
    campos.set('fPP:j_id181:nomeAdv', '');
    campos.set('fPP:j_id190:classeJudicial', '');
    campos.set('fPP:j_id190:sgbClasseJudicial_selection', '');
    campos.set('tipoMascaraDocumento', 'on');
    campos.set('fPP:dpDec:documentoParte', '');
    campos.set('fPP:Decoration:numeroOAB', '');
    campos.set('fPP:Decoration:j_id224', '');
    campos.set('fPP:Decoration:estadoComboOAB',
      'org.jboss.seam.ui.NoSelectionConverter.noSelectionValue');
    campos.set('fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate', '');
    campos.set('fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputCurrentDate', mes);
    campos.set('fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate', '');
    campos.set('fPP:dataAutuacaoDecoration:dataAutuacaoFimInputCurrentDate', mes);
    campos.set('fPP', 'fPP');
    campos.set('autoScroll', '');
    campos.set('javax.faces.ViewState', estado ? estado[1] : 'j_id1');
    campos.set(comando, comando);
    campos.set('AJAX:EVENTS_COUNT', '1');

    // 2. A pesquisa, que devolve a lista de resultados.
    const busca = await ir(enderecoPost.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: consulta },
      body: campos.toString(),
    }, pote);
    const resultado = await texto(busca);

    const link = /openPopUp\('[^']*','(\/[^']*DetalheProcessoConsultaPublica\/listView\.seam\?ca=[^']+)'\)/
      .exec(resultado);
    if (!link) {
      return resposta(200, {
        ok: true, encontrados: 0, html: '',
        aviso: 'A consulta pública do tribunal não encontrou este processo.',
        regiao,
      });
    }

    // 3. O detalhe, com as movimentações.
    const detalhe = await ir(new URL(link[1].replace(/&amp;/g, '&'), enderecoPost).toString(),
      { method: 'GET' }, pote);
    const html = await texto(detalhe);
    if (!detalhe.ok) {
      return resposta(502, { erro: `O tribunal respondeu ${detalhe.status} ao detalhe do `
        + 'processo.', regiao });
    }

    return resposta(200, {
      ok: true,
      encontrados: 1,
      numeroProcesso: comMascara(numero),
      html,
      regiao,
    });
  } catch (e) {
    return resposta(502, {
      erro: 'A consulta pública do tribunal não respondeu.',
      detalhe: e.message,
      regiao,
    });
  }
}

const resposta = (status, corpo) => ({ status, corpo });
