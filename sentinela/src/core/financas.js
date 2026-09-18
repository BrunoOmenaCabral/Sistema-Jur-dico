// Gestão financeira do escritório: honorários contratados, parcelas, cobrança
// e receitas de demandas judiciais.
//
// O contrato guarda as suas parcelas junto de si, e não em coleção separada:
// parcela não existe fora do contrato, e mantê-las no mesmo registro faz com
// que a gravação de um pagamento não possa deixar as duas metades divergentes.
//
// A situação da parcela é deduzida da data, não gravada. Situação gravada
// envelhece sozinha: a parcela vencida ontem continuaria "pendente" até alguém
// rodar a rotina que a corrige.

import { db } from './store.js';
import { hoje, addMonths, fmtData, fmtMoeda, norm } from './util.js';

export const FORMAS_PAGAMENTO = [
  { id: 'a_vista', rotulo: 'À vista' },
  { id: 'parcelado', rotulo: 'Parcelado' },
  { id: 'entrada_parcelado', rotulo: 'Entrada mais parcelas' },
];

export const rotuloForma = (id) =>
  FORMAS_PAGAMENTO.find((f) => f.id === id)?.rotulo || 'À vista';

const centavos = (v) => Math.round(Number(v || 0) * 100);
const emReais = (c) => c / 100;

/**
 * Monta as parcelas do contrato conforme a forma de pagamento.
 *
 * A entrada é a parcela de número zero, quitada na assinatura. A última parcela
 * absorve a diferença do arredondamento, para que a soma feche com o valor
 * contratado até o centavo — diferença de centavos em honorários vira discussão
 * com o cliente.
 */
export function gerarParcelas({
  valorTotal, dataContrato = hoje(), formaPagamento = 'a_vista',
  numeroParcelas = 1, valorEntrada = 0, inicioParcelas = null, dataPagamentoAvista = null,
} = {}) {
  const total = centavos(valorTotal);
  const comEntrada = formaPagamento === 'entrada_parcelado';
  const entrada = comEntrada ? Math.min(Math.max(centavos(valorEntrada), 0), total) : 0;
  const aParcelar = total - entrada;
  const parcelas = [];

  if (entrada > 0) {
    parcelas.push({
      numero: 0, valor: emReais(entrada), vencimento: dataContrato,
      pagoEm: dataContrato, valorPago: emReais(entrada),
    });
  }

  if (formaPagamento === 'a_vista') {
    if (aParcelar > 0) {
      parcelas.push({
        numero: 1, valor: emReais(aParcelar),
        vencimento: dataPagamentoAvista || dataContrato, pagoEm: null, valorPago: null,
      });
    }
    return parcelas;
  }

  const n = Math.max(comEntrada ? 1 : 2, Math.floor(Number(numeroParcelas) || 1));
  const base = Math.round(aParcelar / n);
  const inicio = inicioParcelas || dataContrato;

  for (let i = 0; i < n; i += 1) {
    const ultima = i === n - 1;
    parcelas.push({
      numero: i + 1,
      valor: emReais(ultima ? aParcelar - base * (n - 1) : base),
      vencimento: addMonths(inicio, i),
      pagoEm: null,
      valorPago: null,
    });
  }
  return parcelas;
}

/** Soma das parcelas, para conferir se fecha com o contratado. */
export const somaParcelas = (lista) =>
  emReais((lista || []).reduce((s, p) => s + centavos(p.valor), 0));

/**
 * Parcela no formato corrente.
 *
 * Contratos gravados antes desta versão usavam `n` e não guardavam valor pago;
 * a leitura os acomoda sem precisar reescrever a base.
 */
export function normalizarParcela(parcela, indice = 0) {
  const numero = parcela.numero ?? parcela.n ?? indice + 1;
  return {
    ...parcela,
    numero,
    entrada: numero === 0,
    rotulo: numero === 0 ? 'Entrada' : `${numero}ª parcela`,
    valorPago: parcela.valorPago ?? (parcela.pagoEm ? parcela.valor : null),
  };
}

export const parcelasDo = (contrato) => (contrato?.parcelas || []).map(normalizarParcela);

/** Situação deduzida da data: paga, atrasada ou pendente. */
export function situacaoParcela(parcela, ref = hoje()) {
  if (parcela.pagoEm) return 'paga';
  return parcela.vencimento && parcela.vencimento < ref ? 'atrasada' : 'pendente';
}

export const emAberto = (p, ref = hoje()) => situacaoParcela(p, ref) !== 'paga';

/** Data da última parcela: é quando o contrato se encerra. */
export const terminoDoContrato = (contrato) =>
  parcelasDo(contrato).map((p) => p.vencimento).filter(Boolean).sort().at(-1) || null;

/**
 * Arquiva o contrato cujo termo já passou e cujas parcelas estão todas quitadas.
 *
 * Diferente do sistema de origem, contrato vencido com parcela em aberto não é
 * arquivado: arquivá-lo tiraria da vista justamente a dívida a cobrar.
 */
export function arquivarContratosEncerrados(ref = hoje()) {
  let arquivados = 0;
  for (const c of db.listar('financeiro')) {
    if (c.status === 'arquivado') continue;
    const parcelas = parcelasDo(c);
    if (!parcelas.length) continue;
    const termo = terminoDoContrato(c);
    if (!termo || termo >= ref) continue;
    if (parcelas.some((p) => emAberto(p, ref))) continue;
    db.atualizar('financeiro', c.id, { status: 'arquivado' }, 'Contrato encerrado e arquivado');
    arquivados += 1;
  }
  return arquivados;
}

/* --------------------------------------------- parcelas por cliente ------ */

/** Toda parcela do escritório, com o contrato e o cliente a que pertence. */
export function todasAsParcelas({ ref = hoje(), somenteAbertas = false } = {}) {
  const lista = [];
  for (const contrato of db.listar('financeiro')) {
    for (const parcela of parcelasDo(contrato)) {
      const situacao = situacaoParcela(parcela, ref);
      if (somenteAbertas && situacao === 'paga') continue;
      lista.push({ ...parcela, situacao, contratoId: contrato.id, contrato });
    }
  }
  return lista;
}

/**
 * Agrupa as parcelas em aberto por cliente, com quem está em atraso à frente.
 * É a visão de quem vai cobrar: primeiro quem deve há mais tempo.
 */
export function clientesComParcelasEmAberto({ ref = hoje(), somenteVencidas = false } = {}) {
  const porCliente = new Map();

  for (const item of todasAsParcelas({ ref, somenteAbertas: true })) {
    if (somenteVencidas && item.situacao !== 'atrasada') continue;
    const clienteId = item.contrato.clienteId;
    const atual = porCliente.get(clienteId)
      || { clienteId, parcelas: [], totalAtrasado: 0, totalPendente: 0, atrasadas: 0 };
    atual.parcelas.push(item);
    if (item.situacao === 'atrasada') {
      atual.totalAtrasado += Number(item.valor || 0);
      atual.atrasadas += 1;
    } else atual.totalPendente += Number(item.valor || 0);
    porCliente.set(clienteId, atual);
  }

  return [...porCliente.values()]
    .map((c) => ({ ...c, total: c.totalAtrasado + c.totalPendente }))
    .sort((a, b) => (b.totalAtrasado - a.totalAtrasado) || (b.total - a.total));
}

/** Registra o pagamento da parcela dentro do contrato a que pertence. */
export function registrarPagamento(contratoId, numero, { data = hoje(), valorPago = null } = {}) {
  const contrato = db.obter('financeiro', contratoId);
  if (!contrato) return { ok: false, motivo: 'Contrato não encontrado.' };

  let achou = false;
  const parcelas = (contrato.parcelas || []).map((p, i) => {
    const atual = normalizarParcela(p, i);
    if (atual.numero !== numero) return p;
    achou = true;
    return { ...p, pagoEm: data, valorPago: valorPago ?? atual.valor };
  });
  if (!achou) return { ok: false, motivo: 'Parcela não encontrada.' };

  db.atualizar('financeiro', contratoId, { parcelas },
    `Pagamento da ${numero === 0 ? 'entrada' : `parcela ${numero}`} em ${fmtData(data)}`);
  return { ok: true };
}

/* ------------------------------------------------------- cobrança -------- */

/** Telefone só com dígitos e com o código do país, como o WhatsApp exige. */
export function telefoneInternacional(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (!d) return null;
  return d.startsWith('55') ? d : `55${d}`;
}

/**
 * Mensagem de cobrança. O tom é o de quem pergunta antes de afirmar: o
 * pagamento pode ter sido feito e não compensado, e tratar cliente adimplente
 * como inadimplente custa mais do que a parcela.
 */
export function mensagemCobranca({ nome, numero, vencimento, valor }) {
  const qual = numero === 0 ? 'da entrada' : `da parcela nº ${numero}`;
  return `${nome}, tudo bem? 😊

Verificamos com o setor financeiro e, até o momento, não foi identificado o pagamento `
    + `${qual}, com vencimento em ${fmtData(vencimento)}, no valor de ${fmtMoeda(valor)}.

Poderia, por gentileza, verificar se o pagamento já foi realizado? Caso já tenha efetuado, `
    + `pedimos a gentileza de nos enviar o comprovante para conferência.

Se ainda não foi possível realizar o pagamento, ficamos à disposição para auxiliar `
    + 'no que for necessário.';
}

export const linkWhatsApp = (telefone, mensagem) =>
  `https://api.whatsapp.com/send?phone=${telefoneInternacional(telefone)}`
  + `&text=${encodeURIComponent(mensagem)}`;

/** Guarda a cobrança feita, para que a régua não se repita no mesmo dia. */
export function registrarCobranca({ clienteId, contratoId, numero, observacoes = '' }) {
  return db.inserir('cobrancas', {
    clienteId,
    contratoId,
    parcela: numero,
    dataCobranca: new Date().toISOString(),
    observacoes: observacoes || 'Cobrança enviada via WhatsApp',
  }, 'Cobrança registrada');
}

export const cobrancasDaParcela = (contratoId, numero) => db.listar('cobrancas')
  .filter((c) => c.contratoId === contratoId && c.parcela === numero)
  .sort((a, b) => String(b.dataCobranca).localeCompare(String(a.dataCobranca)));

/* ---------------------------------------------- receitas judiciais ------- */

/** A parte é o cliente cadastrado ou, não havendo, o nome digitado. */
export const parteDaReceita = (receita, nomeCliente) =>
  (receita.clienteId ? nomeCliente(receita.clienteId) : '') || receita.nomeParte || '—';

export function receitasDoMes(mes) {
  const inicio = `${mes}-01`;
  const fim = addMonths(inicio, 1);
  return db.listar('receitas')
    .filter((r) => r.dataRecebimento >= inicio && r.dataRecebimento < fim)
    .sort((a, b) => String(b.dataRecebimento).localeCompare(String(a.dataRecebimento)));
}

export const totalDasReceitas = (lista) =>
  emReais((lista || []).reduce((s, r) => s + centavos(r.valor), 0));

/* -------------------------------------------------------- relatório ------ */

/**
 * Resumo do ano, mês a mês.
 *
 * A parcela entra pelo mês do vencimento; a receita judicial, pelo mês do
 * recebimento. O que está pago conta como recebido pelo valor efetivamente
 * pago, que pode diferir do contratado.
 */
export function resumoAnual(ano, ref = hoje()) {
  const meses = new Map();
  const doMes = (chave) => {
    if (!meses.has(chave)) {
      meses.set(chave, { mes: chave, recebido: 0, judiciais: 0,
        pendente: 0, vencido: 0, parcelas: 0 });
    }
    return meses.get(chave);
  };
  for (let m = 1; m <= 12; m += 1) doMes(`${ano}-${String(m).padStart(2, '0')}`);

  for (const parcela of todasAsParcelas({ ref })) {
    if (!parcela.vencimento?.startsWith(String(ano))) continue;
    const linha = doMes(parcela.vencimento.slice(0, 7));
    linha.parcelas += 1;
    if (parcela.situacao === 'paga') {
      linha.recebido += Number(parcela.valorPago ?? parcela.valor ?? 0);
    } else if (parcela.situacao === 'atrasada') linha.vencido += Number(parcela.valor || 0);
    else linha.pendente += Number(parcela.valor || 0);
  }

  for (const receita of db.listar('receitas')) {
    if (!String(receita.dataRecebimento || '').startsWith(String(ano))) continue;
    doMes(receita.dataRecebimento.slice(0, 7)).judiciais += Number(receita.valor || 0);
  }

  const linhas = [...meses.values()]
    .filter((l) => l.mes.startsWith(String(ano)))
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((l) => ({ ...l, total: l.recebido + l.judiciais }));

  const soma = (campo) => linhas.reduce((s, l) => s + l[campo], 0);
  return {
    ano,
    linhas,
    totais: {
      recebido: soma('recebido'),
      judiciais: soma('judiciais'),
      total: soma('recebido') + soma('judiciais'),
      pendente: soma('pendente'),
      vencido: soma('vencido'),
      parcelas: soma('parcelas'),
    },
  };
}

const numeroCSV = (v) => Number(v || 0).toFixed(2).replace('.', ',');

/** Mesma informação da tela, na ordem em que ela é lida. */
export function csvDoResumo(resumo) {
  const cabecalho = 'Mês,Recebido (Parcelas),Receitas Judiciais,Total Recebido,'
    + 'Pendente,Vencido,Parcelas';
  const linhas = resumo.linhas.map((l) => [
    l.mes, numeroCSV(l.recebido), numeroCSV(l.judiciais), numeroCSV(l.total),
    numeroCSV(l.pendente), numeroCSV(l.vencido), l.parcelas,
  ].join(','));
  return [cabecalho, ...linhas].join('\n');
}

/* --------------------------------------------------------- busca --------- */

export const casaBusca = (termo, ...campos) =>
  !termo || norm(campos.filter(Boolean).join(' ')).includes(norm(termo));

export const mesCorrente = () => hoje().slice(0, 7);
export const mesAnterior = (mes) => addMonths(`${mes}-01`, -1).slice(0, 7);
export const mesSeguinte = (mes) => addMonths(`${mes}-01`, 1).slice(0, 7);
export const podeAvancar = (mes) => mes < mesCorrente();
export const diasDeAtraso = (parcela, ref = hoje()) =>
  (parcela.vencimento && parcela.vencimento < ref
    ? Math.round((new Date(`${ref}T12:00:00`) - new Date(`${parcela.vencimento}T12:00:00`)) / 86400000)
    : 0);
