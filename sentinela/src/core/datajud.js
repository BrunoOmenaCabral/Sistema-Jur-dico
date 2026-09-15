// Consulta processual ao DataJud, a base pública do CNJ.
//
// Diferente do DJEN, que publica intimações, o DataJud reúne a capa e os
// movimentos que cada tribunal alimenta a partir do próprio sistema. É essa a
// fonte para reconstituir o andamento de um processo já cadastrado.
//
// POST https://api-publica.datajud.cnj.jus.br/api_publica_<alias>/_search
// Authorization: APIKey <chave pública divulgada pelo CNJ>
// { "query": { "match": { "numeroProcesso": "<20 dígitos>" } } }
//
// A chave é pública e o CNJ a divulga na documentação: não é credencial do
// escritório e não identifica quem consulta. O que impede a chamada direta do
// navegador é a política de origem, já que o serviço não a autoriza. Havendo
// backend próprio, a consulta passa por ele.

import { db, modoAtual } from './store.js';
import { ponteDisponivel } from './ponte.js';
import { cnjDigitos } from './util.js';

export const BASE_PADRAO = 'https://api-publica.datajud.cnj.jus.br';
export const CHAVE_PUBLICA = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/**
 * Correspondência entre o código de tribunal do número CNJ e o índice do
 * DataJud, levantada consultando o próprio serviço, não deduzida de tabela.
 * A ordem dos estados no número CNJ não é alfabética em todos os pontos.
 */
const TJ_POR_CODIGO = {
  '01': 'tjac', '02': 'tjal', '03': 'tjap', '04': 'tjam', '05': 'tjba', '06': 'tjce',
  '07': 'tjdft', '08': 'tjes', '09': 'tjgo', 10: 'tjma', 11: 'tjmt', 12: 'tjms',
  13: 'tjmg', 14: 'tjpa', 15: 'tjpb', 16: 'tjpr', 17: 'tjpe', 18: 'tjpi', 19: 'tjrj',
  20: 'tjrn', 21: 'tjrs', 22: 'tjro', 23: 'tjrr', 24: 'tjsc', 25: 'tjse', 26: 'tjsp',
  27: 'tjto',
};

/** Tribunais superiores e demais índices que não se deduzem do número. */
export const INDICES = [
  ...Object.values(TJ_POR_CODIGO),
  'trf1', 'trf2', 'trf3', 'trf4', 'trf5', 'trf6',
  ...Array.from({ length: 24 }, (_, i) => `trt${i + 1}`),
  'stj', 'stf', 'tst', 'stm', 'tse',
].sort();

/**
 * Deduz o índice do tribunal.
 *
 * A sigla informada no cadastro tem precedência, por ser a informação do
 * advogado. Na falta dela, vale o número CNJ, cujas posições 14 e 15 e 16
 * identificam o segmento do Judiciário e o tribunal.
 */
export function indiceDoProcesso({ numeroCNJ, tribunal } = {}) {
  const sigla = String(tribunal || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sigla && INDICES.includes(sigla)) return sigla;

  const n = cnjDigitos(numeroCNJ);
  if (n.length !== 20) return null;
  const segmento = n.slice(13, 14);
  const codigo = n.slice(14, 16);

  if (segmento === '8') return TJ_POR_CODIGO[codigo] || TJ_POR_CODIGO[String(Number(codigo))] || null;
  if (segmento === '4') return `trf${Number(codigo)}`;
  if (segmento === '5') return `trt${Number(codigo)}`;
  if (segmento === '3') return 'stj';
  if (segmento === '1') return 'stf';
  return null;
}

/**
 * Há repasse na mesma origem? Servidor próprio e ponte da hospedagem contam.
 * Pelo repasse o contrato é simples — índice e número —, porque quem monta a
 * requisição do Elasticsearch e guarda a chave é o lado do servidor.
 */
export const usandoRepasse = () => modoAtual() === 'servidor' || ponteDisponivel();

/** Endereço em uso: o repasse, quando houver, senão o serviço do CNJ. */
export function baseEmUso() {
  const cfg = db.config().integracoes.tribunais || {};
  if (cfg.baseDatajud) return String(cfg.baseDatajud).replace(/\/$/, '');
  if (usandoRepasse()) return '/api/datajud';
  return BASE_PADRAO;
}

/**
 * Consulta a capa e os movimentos de um processo.
 *
 * @returns {Promise<{ok:boolean, motivo:string|null, processo:object|null, movimentos:Array}>}
 */
export async function consultarProcesso({ numeroCNJ, tribunal, indice = null, sinal = null }) {
  const numero = cnjDigitos(numeroCNJ);
  if (numero.length !== 20) return falha('Número CNJ inválido.');

  const alvo = indice || indiceDoProcesso({ numeroCNJ: numero, tribunal });
  if (!alvo) {
    return falha('Não foi possível identificar o tribunal a partir do número. '
      + 'Informe a sigla no cadastro do processo ou escolha o tribunal na consulta.');
  }

  const repasse = usandoRepasse();
  const endereco = repasse ? baseEmUso() : `${baseEmUso()}/api_publica_${alvo}/_search`;
  const cabecalhos = { 'Content-Type': 'application/json' };
  // A chave só acompanha a chamada direta: no repasse quem a guarda é o servidor.
  if (!repasse) cabecalhos.Authorization = `APIKey ${CHAVE_PUBLICA}`;

  let resposta;
  try {
    resposta = await fetch(endereco, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify(repasse
        ? { indice: alvo, numeroProcesso: numero }
        : { query: { match: { numeroProcesso: numero } }, size: 10 }),
      signal: sinal,
    });
  } catch (e) {
    return falha(ponteDisponivel()
      ? `A ponte desta hospedagem não respondeu à consulta ao DataJud. Detalhe: ${e.message}`
      : 'Esta hospedagem não repassa consultas, e o serviço do CNJ não autoriza chamada vinda '
        + 'de outra origem: o navegador bloqueia antes de sair. Abra o sistema pelo endereço que '
        + 'tem a ponte de consultas, ou rode com o servidor próprio. Enquanto isso, o andamento '
        + `pode ser lançado à mão em "Registrar movimentação". Detalhe técnico: ${e.message}`);
  }

  if (resposta.status === 404) {
    const detalhe = await resposta.text().catch(() => '');
    // Rota de repasse ausente devolve a página de erro da hospedagem, não JSON.
    if (repasse && !detalhe.trim().startsWith('{')) {
      return falha('A ponte de consultas não respondeu nesta hospedagem. Abra o sistema pelo '
        + 'endereço que tem a ponte, ou rode com o servidor próprio.');
    }
    return falha(`O DataJud não tem o índice do tribunal ${alvo.toUpperCase()}. `
      + 'Confira o tribunal escolhido.');
  }
  if (!resposta.ok) return falha(`O DataJud respondeu ${resposta.status}. Tente novamente em instantes.`);

  let dados;
  try { dados = await resposta.json(); }
  catch { return falha('O DataJud devolveu resposta ilegível.'); }

  const achados = dados?.hits?.hits || [];
  if (!achados.length) {
    return falha(`Nenhum processo encontrado no índice ${alvo}. Processos em segredo de justiça `
      + 'não são publicados, e a base pode não ter recebido este ainda.');
  }

  // Havendo mais de um grau, prevalece o registro atualizado mais recentemente.
  const fonte = achados
    .map((h) => h._source)
    .sort((a, b) => String(b.dataHoraUltimaAtualizacao).localeCompare(String(a.dataHoraUltimaAtualizacao)))[0];

  return {
    ok: true,
    motivo: null,
    indice: alvo,
    graus: achados.length,
    processo: {
      numeroCNJ: fonte.numeroProcesso,
      tribunal: fonte.tribunal || '',
      grau: fonte.grau || '',
      classe: fonte.classe?.nome || '',
      assunto: (fonte.assuntos || []).map((a) => a.nome).filter(Boolean).join(', '),
      vara: fonte.orgaoJulgador?.nome || '',
      sistema: fonte.sistema?.nome || '',
      dataDistribuicao: soData(fonte.dataAjuizamento),
      atualizadoEm: fonte.dataHoraUltimaAtualizacao || null,
    },
    movimentos: (fonte.movimentos || [])
      .map((m) => movimentoComoRegistro(m, fonte))
      .filter((m) => m.data)
      .sort((a, b) => String(a.data).localeCompare(String(b.data))),
  };
}

const falha = (motivo) => ({ ok: false, motivo, processo: null, movimentos: [], indice: null });

/**
 * Converte um movimento do DataJud em registro da linha do tempo.
 *
 * O complemento tabelado é o que dá sentido ao movimento: "Audiência" sozinho
 * não diz nada, "Audiência — designada" diz. Por isso ele entra no teor.
 */
export function movimentoComoRegistro(movimento, processo = {}) {
  const complementos = (movimento.complementosTabelados || [])
    .map((c) => c.nome).filter(Boolean);
  return {
    data: soData(movimento.dataHora),
    titulo: movimento.nome || 'Movimentação',
    descricao: complementos.join(' · '),
    origem: 'andamento processual',
    // Identifica o movimento na origem, para não importar o mesmo duas vezes.
    chaveExterna: `datajud:${processo.tribunal || ''}:${movimento.codigo}:${movimento.dataHora}`,
  };
}

/** O DataJud usa ISO em uns campos e AAAAMMDDHHMMSS em outros. */
function soData(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  if (/^\d{8}/.test(texto)) return `${texto.slice(0, 4)}-${texto.slice(4, 6)}-${texto.slice(6, 8)}`;
  return null;
}
