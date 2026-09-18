// Camada de inteligência aplicada a publicações e documentos.
//
// Regra inegociável do sistema: a IA sugere, o advogado decide. Nenhum prazo
// entra na agenda sem confirmação humana.
//
// O provedor padrão é heurístico e roda inteiramente no navegador. Um provedor
// externo (API de modelo de linguagem) pode ser configurado em Configurações,
// mantendo a mesma interface `interpretarPublicacao`.

import { db } from './store.js';
import { cnjDigitos, fmtCNJ, fmtData, norm, hoje } from './util.js';
import { calcularPrazo, TIPOS_PRAZO } from './calculo-prazo.js';
import { linhaDoTempo, processoDe, nomeCliente, panoramaCliente } from './dominio.js';

const NUMEROS_EXTENSO = {
  um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
};

// A ordem importa: expressões mais específicas primeiro, para que
// "manifestar-se sobre a contestação" não seja lido como prazo de contestação.
const PADROES_TIPO = [
  [/manifest|dar ci[êe]ncia|falar nos autos|impugnar os documentos/, 'manifestacao'],
  [/r[ée]plica|impugna[çc][ãa]o [àa] contesta[çc][ãa]o/, 'replica'],
  [/contrarraz[õo]es/, 'contrarrazoes'],
  [/embargos de declara[çc][ãa]o|embargos [àa] execu[çc][ãa]o/, 'embargos'],
  [/apela[çc][ãa]o/, 'apelacao'],
  [/agravo/, 'agravo'],
  [/cumprimento de senten[çc]a/, 'cumprimento'],
  [/apresentar contesta[çc][ãa]o|oferecer contesta[çc][ãa]o|contestar a a[çc][ãa]o|para contestar/, 'contestacao'],
  [/efetuar o pagamento|recolher as custas|comprovar o pagamento|pagamento volunt[áa]rio/, 'pagamento'],
  [/rol de testemunhas|audi[êe]ncia/, 'audiencia'],
  [/sustenta[çc][ãa]o oral/, 'sustentacao'],
  [/cumpra-se|dar cumprimento|despacho/, 'despacho'],
  [/interpor recurso|recurso/, 'recurso'],
  [/contesta[çc][ãa]o/, 'contestacao'],
];

/** Extrai a quantidade de dias mencionada na publicação. */
function extrairDias(texto) {
  const t = norm(texto);
  const numerico = t.match(/prazo\s+(?:comum\s+|sucessivo\s+|improrrog[aá]vel\s+)?de\s+(\d{1,3})\s*\(?[^)]*\)?\s*dias?/)
    || t.match(/no\s+prazo\s+de\s+(\d{1,3})\s*dias?/)
    || t.match(/em\s+(\d{1,3})\s*\(?[^)]*\)?\s*dias?/)
    || t.match(/(\d{1,3})\s*dias?\s+[úu]teis/);
  if (numerico) return Number(numerico[1]);
  const extenso = t.match(/prazo\s+de\s+([a-z]+)\s+dias?/);
  if (extenso && NUMEROS_EXTENSO[extenso[1]]) return NUMEROS_EXTENSO[extenso[1]];
  return null;
}

function extrairContagem(texto) {
  const t = norm(texto);
  if (/dias?\s+[úu]teis/.test(t)) return { contagem: 'uteis', explicito: true };
  if (/dias?\s+corridos/.test(t)) return { contagem: 'corridos', explicito: true };
  return { contagem: null, explicito: false };
}

function extrairTipo(texto) {
  const t = norm(texto);
  for (const [re, tipo] of PADROES_TIPO) if (re.test(t)) return tipo;
  return 'outros';
}

export function extrairNumerosCNJ(texto) {
  const achados = String(texto || '').match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g) || [];
  return [...new Set(achados.map(cnjDigitos))].filter((n) => n.length === 20);
}

/**
 * Interpreta o texto de uma publicação e devolve uma sugestão de prazo.
 * O resultado é sempre marcado como pendente de confirmação.
 */
export function interpretarPublicacao(publicacao) {
  const texto = publicacao.conteudo || '';
  const numeros = extrairNumerosCNJ(`${publicacao.numeroCNJ || ''} ${texto}`);
  const numero = numeros[0] || cnjDigitos(publicacao.numeroCNJ);
  const processo = db.listar('processos').find((p) => cnjDigitos(p.numeroCNJ) === numero) || null;

  const dias = extrairDias(texto);
  const tipo = extrairTipo(texto);
  const padraoTipo = TIPOS_PRAZO.find((t) => t.id === tipo);
  const { contagem, explicito } = extrairContagem(texto);
  const contagemFinal = contagem || padraoTipo?.contagem || 'uteis';
  const diasFinal = dias || padraoTipo?.dias || null;

  const alertas = [];
  if (!processo) alertas.push('Processo não localizado na base. Cadastre-o antes de confirmar o prazo.');
  if (!dias && diasFinal) alertas.push(`A publicação não indica a quantidade de dias. Aplicado o padrão do tipo (${diasFinal}).`);
  if (!diasFinal) alertas.push('Não foi possível identificar prazo no texto. Confira manualmente.');
  if (!explicito) alertas.push(`A publicação não especifica a forma de contagem. Adotada a regra padrão: ${contagemFinal === 'uteis' ? 'dias úteis (art. 219 do CPC)' : 'dias corridos'}.`);
  if (/intime-se a parte (r[ée]|adversa|contr[áa]ria)/i.test(texto)) {
    alertas.push('A intimação pode ser dirigida à parte contrária. Confirme quem tem prazo.');
  }

  let calculo = null;
  if (diasFinal) {
    calculo = calcularPrazo({
      dataDisponibilizacao: publicacao.dataDisponibilizacao || null,
      dataPublicacao: publicacao.dataPublicacao || null,
      dias: diasFinal,
      contagem: contagemFinal,
      contexto: { uf: processo?.uf, municipio: processo?.comarca, tribunal: processo?.tribunal },
      calendario: {
        feriados: db.listar('feriados'), suspensoes: db.listar('suspensoes'),
        recessoForense: db.config().recessoForense !== false,
      },
    });
  }

  const confianca = calcularConfianca({ processo, dias, explicito, tipo });

  return {
    provedor: 'heuristico',
    geradoEm: new Date().toISOString(),
    numeroCNJ: numero, processoId: processo?.id || null,
    clienteNome: processo ? nomeCliente(processo.clienteId) : null,
    tipo, tipoRotulo: padraoTipo?.rotulo || 'Outros',
    dias: diasFinal, contagem: contagemFinal,
    dataPublicacao: calculo?.dataPublicacao || publicacao.dataPublicacao,
    inicioSugerido: calculo?.inicio || null,
    vencimentoSugerido: calculo?.vencimento || null,
    calculo, alertas, confianca,
    exigeConfirmacao: true,
  };
}

function calcularConfianca({ processo, dias, explicito, tipo }) {
  let s = 0;
  if (processo) s += 40;
  if (dias) s += 30;
  if (explicito) s += 15;
  if (tipo !== 'outros') s += 15;
  return s;
}

/* ------------------------------------------- leitura de despacho/decisão -- */

// Natureza do ato judicial. A ordem importa: a sentença absorve expressões
// que também aparecem em decisão interlocutória.
const PADROES_NATUREZA = [
  [/julgo\s+(procedente|improcedente|parcialmente|extinto)|senten[çc]a|homologo o acordo/, 'sentença'],
  [/ac[óo]rd[ãa]o|dou provimento|nego provimento|conhe[çc]o do recurso/, 'acórdão'],
  [/defiro|indefiro|concedo|denego|tutela (de urg[êe]ncia|antecipada)|liminar|decis[ãa]o/, 'decisão'],
  [/design(o|ada|ei|ada a)|audi[êe]ncia/, 'designação de audiência'],
  [/cumpra-se|intime-se|manifeste-se|despacho|vista dos autos/, 'despacho'],
  [/juntada|petição protocolada|certid[ãa]o/, 'juntada'],
];

// Cada determinação é reconhecida por uma expressão e descrita em linguagem
// direta. Nada é afirmado sem que a expressão apareça no texto do ato.
const PADROES_DETERMINACAO = [
  [/\b(defiro|concedo|deferid[ao]) a (tutela|liminar|antecipa)/, 'o pedido de tutela de urgência foi deferido'],
  [/(indefiro|denego|indeferid[ao]) a (tutela|liminar|antecipa)/, 'o pedido de tutela de urgência foi indeferido'],
  [/julgo procedente/, 'o pedido foi julgado procedente'],
  [/julgo parcialmente procedente/, 'o pedido foi julgado parcialmente procedente'],
  [/julgo improcedente/, 'o pedido foi julgado improcedente'],
  [/julgo extinto|extin[çc][ãa]o do processo/, 'o processo foi extinto'],
  [/homologo o acordo|acordo homologado/, 'o acordo foi homologado'],
  [/dou provimento/, 'o recurso foi provido'],
  [/nego provimento/, 'o recurso foi desprovido'],
  [/determino a per[íi]cia|per[íi]cia (m[ée]dica|cont[áa]bil|t[ée]cnica)|nomeio perito/, 'foi determinada a realização de perícia'],
  [/cite-se|determino a cita[çc][ãa]o/, 'foi determinada a citação da parte contrária'],
  [/intime-se a parte contr[áa]ria|intima[çc][ãa]o da parte (r[ée]|adversa)/, 'a parte contrária foi intimada'],
  [/expe[çc]a-se (o )?(mandado|of[íi]cio|alvar[áa])/, 'foi determinada a expedição de mandado, ofício ou alvará'],
  [/suspens[ãa]o do (processo|feito)|suspendo o (processo|feito)/, 'o processo foi suspenso'],
  [/arquivem-se|determino o arquivamento/, 'foi determinado o arquivamento'],
  [/convers[ãa]o em dilig[êe]ncia/, 'os autos foram convertidos em diligência'],
  [/custas|recolhimento das custas/, 'houve determinação sobre custas processuais'],
];

// Abertura da descrição conforme o ato. Sentença e despacho são proferidos,
// audiência é designada, juntada não é ato do juízo.
const ABERTURA_NATUREZA = {
  'sentença': 'Foi proferida sentença',
  'acórdão': 'Foi proferido acórdão',
  'decisão': 'Foi proferida decisão',
  'despacho': 'Foi proferido despacho',
  'designação de audiência': 'Foi designada audiência',
  'juntada': 'Houve juntada de petição ou documento',
};

/**
 * Lê o texto de um despacho, decisão ou movimentação e devolve o que dali se
 * extrai com segurança: a natureza do ato, as determinações identificadas e o
 * prazo, quando houver. O que não estiver escrito não é suposto.
 */
export function analisarAndamento(texto) {
  const bruto = String(texto || '').trim();
  const t = norm(bruto);
  if (!t) return { natureza: null, determinacoes: [], dias: null, tipo: null, resumo: '', confiavel: false };

  const natureza = (PADROES_NATUREZA.find(([re]) => re.test(t)) || [])[1] || null;
  const determinacoes = PADROES_DETERMINACAO.filter(([re]) => re.test(t)).map(([, texto]) => texto);
  const dias = extrairDias(bruto);
  const tipo = extrairTipo(bruto);
  const audiencia = bruto.match(/(\d{2}\/\d{2}\/\d{4})/);
  const partes = [];
  if (natureza === 'designação de audiência') {
    partes.push(audiencia ? `Foi designada audiência para ${audiencia[1]}` : 'Foi designada audiência');
  } else if (natureza) partes.push(ABERTURA_NATUREZA[natureza]);
  if (determinacoes.length) partes.push(determinacoes.join(', '));
  if (dias) {
    const rotulo = TIPOS_PRAZO.find((x) => x.id === tipo)?.rotulo;
    partes.push(`foi aberto prazo de ${dias} dias${rotulo && tipo !== 'outros' ? ` para ${rotulo.toLowerCase()}` : ''}`);
  }

  return {
    natureza,
    determinacoes,
    dias,
    tipo: tipo === 'outros' ? null : tipo,
    resumo: partes.length ? `${partes.join('; ')}.` : '',
    // Sem natureza nem determinação, o texto não sustenta descrição objetiva.
    confiavel: Boolean(natureza || determinacoes.length),
  };
}

/**
 * Apura o que houve de novo no processo desde uma data e descreve de forma
 * objetiva, para comunicação ao cliente.
 *
 * Considera publicações e movimentações, que são o que o sistema recebe do
 * DJEN e do acompanhamento processual. Quando o texto não permite descrição
 * segura, o item é devolvido marcado como tal, e não inventado.
 */
export function novidadesDoProcesso(processoId, { desde = null, limite = 12 } = {}) {
  const processo = processoDe(processoId);
  if (!processo) return { processo: null, itens: [], texto: '', total: 0, omitidos: 0 };

  const corte = desde || ultimaComunicacao(processoId);
  // Período pedido pelo escritório inclui o próprio dia do corte — "a partir de
  // ontem" tem de alcançar a juntada de ontem. Já o corte deduzido do último
  // envio ao cliente é exclusivo, para não repetir o que já foi comunicado.
  const inclusivo = Boolean(desde);
  const dentro = (data) => Boolean(data) && (!corte || (inclusivo ? data >= corte : data > corte));
  const itens = [];

  for (const pub of db.listar('publicacoes', { processoId })) {
    const data = pub.dataPublicacao || pub.dataDisponibilizacao;
    if (!dentro(data)) continue;
    itens.push({ data, origem: 'DJEN', ...analisarAndamento(pub.conteudo), fonte: pub.conteudo });
  }
  for (const mov of db.listar('movimentacoes', { processoId })) {
    if (!dentro(mov.data)) continue;
    // O teor do ato, quando foi possível obtê-lo, descreve melhor que o rótulo.
    const conteudo = mov.teor || mov.descricao || '';
    const analise = analisarAndamento(`${mov.titulo || ''} ${conteudo}`);
    itens.push({ data: mov.data, titulo: mov.titulo || '',
      // Só o que veio da consulta tem chave externa: é o que distingue o
      // importado do lançado à mão, qualquer que seja a origem escolhida no
      // formulário.
      externo: Boolean(mov.chaveExterna),
      origem: mov.origem === 'manual' ? 'registro interno' : 'andamento processual',
      ...analise, fonte: conteudo || mov.titulo });
  }

  // O ato lançado à mão e depois importado do tribunal é o mesmo ato: no texto
  // enviado ao cliente sairia em duplicidade. Prevalece o registro importado,
  // que traz código e teor. Atos homônimos vindos da consulta permanecem, pois
  // podem ser distintos — inclusive em instâncias diferentes.
  const doTribunal = new Set(itens.filter((i) => i.externo && i.titulo)
    .map((i) => `${i.data}|${norm(i.titulo)}`));
  const unicos = itens.filter((i) => i.externo || !i.titulo
    || !doTribunal.has(`${i.data}|${norm(i.titulo)}`));

  unicos.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  // Limite nulo traz o período inteiro: relatório que recorta em silêncio faz o
  // escritório crer que não houve andamento.
  const teto = limite === null || limite === Infinity ? unicos.length : Math.max(0, limite);
  const recortados = unicos.slice(0, teto);

  const linhas = recortados.map((i) => {
    const descricao = i.confiavel ? i.resumo
      : `houve movimentação registrada${i.fonte ? `: ${String(i.fonte).replace(/\s+/g, ' ').slice(0, 180)}` : ''}.`;
    return `• ${fmtData(i.data)} — ${descricao}`;
  });

  return {
    processo,
    desde: corte,
    itens: recortados,
    total: unicos.length,
    omitidos: unicos.length - recortados.length,
    texto: linhas.join('\n'),
  };
}

/** Data da última comunicação enviada ao cliente sobre este processo. */
function ultimaComunicacao(processoId) {
  const enviadas = db.listar('comunicacoes', { processoId })
    .map((c) => String(c.enviadoEm || '').slice(0, 10)).filter(Boolean).sort();
  return enviadas.at(-1) || null;
}

/**
 * Texto pronto para o cliente com o que mudou no processo. É rascunho: a tela
 * de comunicações abre o conteúdo em edição antes de qualquer envio.
 */
export function mensagemNovidades(processoId, { desde = null } = {}) {
  const v = novidadesDoProcesso(processoId, { desde });
  if (!v.processo) return '';
  const cliente = nomeCliente(v.processo.clienteId);
  const primeiroNome = String(cliente || 'cliente').split(' ')[0];
  const cabecalho = `Olá, ${primeiroNome}. Segue a atualização do processo nº ${fmtCNJ(v.processo.numeroCNJ)}.`;

  if (!v.itens.length) {
    return `${cabecalho}\n\nNão houve movimentação nova desde a última comunicação. `
      + 'O processo segue em acompanhamento pelo escritório.';
  }
  return `${cabecalho}\n\n${v.texto}\n\n`
    + 'Permanecemos acompanhando o andamento e informaremos qualquer novidade.';
}

/* ---------------------------------------------- assistente do processo -- */

/**
 * Responde perguntas sobre um processo utilizando exclusivamente os dados
 * cadastrados. Quando a informação não existe, o assistente diz que não existe.
 */
export function assistenteProcesso(processoId, pergunta) {
  const p = processoDe(processoId);
  if (!p) return { resposta: 'Processo não localizado.', fontes: [] };
  const q = norm(pergunta);
  const timeline = linhaDoTempo(processoId);
  const fontes = [];
  const linhas = [];

  const desde = (dias) => {
    const limite = new Date(); limite.setDate(limite.getDate() - dias);
    const alvo = limite.toISOString().slice(0, 10);
    return timeline.filter((t) => t.data >= alvo);
  };

  if (/ultimos?\s+(\d+)\s+dias|resum/.test(q)) {
    const n = Number((q.match(/(\d+)\s*dias/) || [])[1] || 30);
    const itens = desde(n);
    linhas.push(itens.length
      ? `Nos últimos ${n} dias foram registrados ${itens.length} eventos neste processo:`
      : `Não há registros nos últimos ${n} dias para este processo.`);
    itens.slice(0, 12).forEach((t) => {
      linhas.push(`• ${fmtData(t.data)} — ${t.titulo}${t.detalhe ? `: ${String(t.detalhe).slice(0, 160)}` : ''}`);
      fontes.push(`${t.tipo} ${fmtData(t.data)}`);
    });
  } else if (/prazo/.test(q)) {
    const prazos = db.listar('prazos', { processoId }).filter((x) => ['pendente', 'andamento'].includes(x.status));
    linhas.push(prazos.length
      ? 'Prazos em aberto:' : 'Não há prazos em aberto cadastrados para este processo.');
    prazos.forEach((x) => linhas.push(`• ${TIPOS_PRAZO.find((t) => t.id === x.tipo)?.rotulo} — vencimento em ${fmtData(x.dataVencimento)}`));
  } else if (/audi[êe]ncia/.test(q)) {
    const aud = db.listar('audiencias', { processoId });
    linhas.push(aud.length ? 'Audiências cadastradas:' : 'Não há audiência cadastrada para este processo.');
    aud.forEach((a) => linhas.push(`• ${fmtData(a.data)} ${a.hora || ''} — ${a.modalidade || ''}`));
  } else if (/documento/.test(q)) {
    const docs = db.listar('documentos', { processoId });
    linhas.push(docs.length ? 'Documentos anexados:' : 'Nenhum documento anexado a este processo.');
    docs.forEach((d) => linhas.push(`• ${d.categoria} — ${d.nome}`));
  } else {
    linhas.push(`Processo ${fmtCNJ(p.numeroCNJ)} — ${p.classe || 'classe não informada'}, `
      + `${p.vara || 'vara não informada'}, ${p.tribunal || 'tribunal não informado'}.`);
    linhas.push(`Cliente: ${nomeCliente(p.clienteId)} · Situação: ${p.status} · Fase: ${p.fase || 'não informada'}.`);
    const ultimo = timeline[0];
    linhas.push(ultimo ? `Último registro: ${fmtData(ultimo.data)} — ${ultimo.titulo}.` : 'Ainda não há registros na linha do tempo.');
  }

  linhas.push('');
  linhas.push('Resposta baseada exclusivamente nos dados cadastrados neste processo.');
  return { resposta: linhas.join('\n'), fontes };
}

/* ------------------------------------------------- relatório do cliente -- */

/**
 * Converte a situação processual em explicação compreensível ao cliente,
 * sem reproduzir o andamento bruto.
 */
export function relatorioCliente(clienteId, { incluirEncerrados = true } = {}) {
  const v = panoramaCliente(clienteId);
  if (!v.cliente) return null;
  const linhas = [];
  linhas.push(`RELATÓRIO PROCESSUAL — ${v.cliente.nome}`);
  linhas.push(`Emitido em ${fmtData(hoje())} por ${db.config().escritorio.nome}`);
  linhas.push('');
  linhas.push(`Você possui ${v.ativos.length} processo(s) em andamento`
    + (v.encerrados.length ? ` e ${v.encerrados.length} já encerrado(s).` : '.'));
  linhas.push('');

  const alvo = incluirEncerrados ? v.processos : v.ativos;
  for (const p of alvo) {
    const prazos = v.prazos.filter((x) => x.processoId === p.id);
    const audiencias = v.audiencias.filter((a) => a.processoId === p.id);
    const eventos = linhaDoTempo(p.id);
    const ultimo = eventos.find((e) => ['publicacao', 'movimentacao', 'audiencia', 'concluido'].includes(e.tipo));

    linhas.push(`PROCESSO ${fmtCNJ(p.numeroCNJ)}`);
    linhas.push(`Assunto: ${p.assunto || p.classe || 'não informado'}`);
    linhas.push(`Situação atual: ${descreverSituacao(p, prazos, audiencias)}`);
    if (ultimo) linhas.push(`Última movimentação: ${traduzirEvento(ultimo)} em ${fmtData(ultimo.data)}.`);
    if (audiencias.length) {
      const a = audiencias[0];
      linhas.push(`Audiência marcada para ${fmtData(a.data)}${a.hora ? ` às ${a.hora}` : ''}`
        + `${a.modalidade ? ` (${a.modalidade.toLowerCase()})` : ''}.`);
    }
    linhas.push(`Próxima providência: ${descreverProvidencia(prazos, audiencias)}`);
    if (prazos.length) linhas.push(`Próximo prazo do escritório: ${fmtData(prazos[0].dataVencimento)}.`);
    if (p.observacoesCliente) linhas.push(`Observação: ${p.observacoesCliente}`);
    linhas.push('');
  }

  const pendencias = v.tarefas.filter((t) => /document|procura[çc]|assinat/i.test(t.titulo));
  if (pendencias.length) {
    linhas.push('PROVIDÊNCIAS PENDENTES DE SUA PARTE');
    pendencias.forEach((t) => linhas.push(`• ${t.titulo}`));
    linhas.push('');
  }
  linhas.push('Este relatório reúne a situação atual dos seus processos em linguagem simples. '
    + 'Qualquer dúvida pode ser encaminhada diretamente ao escritório.');
  return { cliente: v.cliente, texto: linhas.join('\n'), panorama: v };
}

function descreverSituacao(processo, prazos, audiencias) {
  if (['encerrado', 'arquivado'].includes(processo.status)) return 'processo encerrado';
  if (audiencias.length) return 'aguardando a realização de audiência';
  if (prazos.length) {
    const p = prazos[0];
    const mapa = {
      contestacao: 'em elaboração da defesa', replica: 'em elaboração de manifestação sobre a defesa apresentada',
      recurso: 'em preparação de recurso', apelacao: 'em preparação de recurso',
      manifestacao: 'aguardando manifestação do escritório', cumprimento: 'em fase de cobrança do valor devido',
      pagamento: 'aguardando providência de pagamento',
    };
    return mapa[p.tipo] || 'com providência em elaboração pelo escritório';
  }
  return 'aguardando movimentação do Poder Judiciário';
}

function traduzirEvento(evento) {
  const mapa = {
    publicacao: 'decisão ou despacho publicado pelo tribunal',
    movimentacao: 'movimentação registrada no processo',
    audiencia: 'audiência realizada ou designada',
    concluido: 'providência concluída pelo escritório',
  };
  return mapa[evento.tipo] || evento.titulo;
}

function descreverProvidencia(prazos, audiencias) {
  if (audiencias.length) return 'comparecimento à audiência designada';
  if (prazos.length) return 'protocolo da petição dentro do prazo indicado';
  return 'acompanhamento das movimentações do processo';
}

/* --------------------------------------------- relatório processual ------ */

/**
 * Relatório de movimentações para envio ao cliente.
 *
 * Difere do relatório geral por recortar um período e descrever cada
 * movimentação a partir da leitura do despacho ou decisão correspondente.
 * Só entra no texto o que foi efetivamente recebido do DJEN, do andamento
 * processual ou registrado pelo escritório.
 */
export function relatorioProcessual({ clienteId, processoId = null, desde = null }) {
  const cliente = clienteId ? db.obter('clientes', clienteId) : null;
  const processos = processoId
    ? [processoDe(processoId)].filter(Boolean)
    : db.listar('processos', { clienteId }).filter((p) => p.status === 'ativo');

  if (!cliente || !processos.length) {
    return { cliente, processos: [], texto: '', vazio: true };
  }

  const escritorio = db.config().escritorio;
  const linhas = [
    `RELATÓRIO PROCESSUAL — ${cliente.nome}`,
    `Emitido em ${fmtData(hoje())} por ${escritorio.nome}`,
  ];
  if (desde) linhas.push(`Período considerado: a partir de ${fmtData(desde)}`);
  linhas.push('');

  let totalMovimentos = 0;
  const semConferencia = [];
  for (const p of processos) {
    // Sem recorte: o relatório do período mostra o período inteiro.
    const v = novidadesDoProcesso(p.id, { desde, limite: null });
    const prazos = db.listar('prazos', { processoId: p.id })
      .filter((x) => ['pendente', 'andamento'].includes(x.status))
      .sort((a, b) => String(a.dataVencimento).localeCompare(String(b.dataVencimento)));
    const audiencias = db.listar('audiencias', { processoId: p.id })
      .filter((a) => a.data >= hoje() && a.status !== 'cancelada');

    linhas.push(`PROCESSO ${fmtCNJ(p.numeroCNJ)}`);
    linhas.push(`Assunto: ${p.assunto || p.classe || 'não informado'}`);
    if (p.vara || p.tribunal) linhas.push(`Juízo: ${[p.vara, p.tribunal].filter(Boolean).join(' — ')}`);
    // Diz até quando o andamento foi conferido na origem: sem isso, o silêncio
    // do relatório se confunde com ausência de movimentação.
    if (p.ultimaConsultaTribunal) {
      linhas.push(`Andamento conferido junto ao tribunal em ${fmtData(p.ultimaConsultaTribunal)}.`);
    } else {
      semConferencia.push(p);
    }
    linhas.push('');
    linhas.push('Movimentações do período:');
    if (v.itens.length) {
      totalMovimentos += v.itens.length;
      linhas.push(v.texto);
    } else {
      linhas.push('• Não houve movimentação no período. O processo segue em acompanhamento.');
    }
    if (audiencias.length) {
      const a = audiencias[0];
      linhas.push('');
      linhas.push(`Audiência designada para ${fmtData(a.data)}${a.hora ? ` às ${a.hora}` : ''}`
        + `${a.modalidade ? ` (${a.modalidade.toLowerCase()})` : ''}.`);
    }
    if (prazos.length) {
      linhas.push('');
      linhas.push(`Próxima providência do escritório: ${fmtData(prazos[0].dataVencimento)}.`);
    }
    linhas.push('');
  }

  linhas.push('Este relatório reúne o andamento dos seus processos no período indicado. '
    + 'Qualquer dúvida pode ser encaminhada diretamente ao escritório.');

  return { cliente, processos, desde, totalMovimentos, semConferencia,
    texto: linhas.join('\n'), vazio: false };
}
