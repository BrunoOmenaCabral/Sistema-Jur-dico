// Regras de negócio: relacionam cliente, processo, publicação, prazo, tarefa,
// audiência, documento e comunicação. Nenhuma view acessa o store diretamente
// para consultas compostas — tudo passa por aqui.

import { db } from './store.js';
import {
  hoje, iso, addDays, diffDias, toDate, norm, ordenarPor, fmtData, fmtCNJ, cnjDigitos,
} from './util.js';
import { diasUteisAte, tipoPrazo } from './calculo-prazo.js';

/* ------------------------------------------------------------ domínios -- */

export const PRIORIDADES = [
  { id: 'normal', rotulo: 'Normal', peso: 0, cor: 'var(--c-normal)' },
  { id: 'importante', rotulo: 'Importante', peso: 1, cor: 'var(--c-tarefa)' },
  { id: 'urgente', rotulo: 'Urgente', peso: 2, cor: 'var(--c-proximo)' },
  { id: 'fatal', rotulo: 'Fatal', peso: 3, cor: 'var(--c-fatal)' },
];

export const STATUS_PRAZO = [
  { id: 'pendente', rotulo: 'Pendente' },
  { id: 'andamento', rotulo: 'Em andamento' },
  { id: 'concluido', rotulo: 'Concluído' },
  { id: 'cancelado', rotulo: 'Cancelado' },
];

export const FASES_PROCESSO = ['Conhecimento', 'Instrução', 'Sentença', 'Recursal',
  'Cumprimento de sentença', 'Execução', 'Arquivado'];

export const STATUS_PROCESSO = ['ativo', 'suspenso', 'encerrado', 'arquivado'];

export const CATEGORIAS_DOCUMENTO = ['Procuração', 'Contrato', 'Petição', 'Decisão',
  'Sentença', 'Acórdão', 'Comprovante', 'Documento do cliente', 'Diversos'];

export const MODALIDADES_AUDIENCIA = ['Presencial', 'Virtual', 'Híbrida'];

export const abertos = ['pendente', 'andamento'];

/* --------------------------------------------------------- referências -- */

export const clienteDe = (id) => db.obter('clientes', id);
export const processoDe = (id) => db.obter('processos', id);
export const usuarioDe = (id) => db.obter('usuarios', id);
export const nomeUsuario = (id) => usuarioDe(id)?.nome || '—';
export const nomeCliente = (id) => clienteDe(id)?.nome || '—';

export function rotuloProcesso(id) {
  const p = processoDe(id);
  return p ? fmtCNJ(p.numeroCNJ) : '—';
}

/* ------------------------------------------------------- prazos: apoio -- */

export function situacaoPrazo(prazo, ref = hoje()) {
  if (prazo.status === 'concluido') return 'concluido';
  if (prazo.status === 'cancelado') return 'cancelado';
  const dias = diffDias(ref, prazo.dataVencimento);
  if (dias < 0) return 'vencido';
  if (dias === 0) return 'hoje';
  if (dias <= 3) return 'critico';
  if (dias <= 7) return 'proximo';
  return 'futuro';
}

const ROTULO_SITUACAO = {
  vencido: 'Vencido', hoje: 'Vence hoje', critico: 'Crítico',
  proximo: 'Próximo', futuro: 'Futuro', concluido: 'Concluído', cancelado: 'Cancelado',
};
export const rotuloSituacao = (s) => ROTULO_SITUACAO[s] || s;

export function corDoItem(item) {
  const c = db.config().cores;
  if (item.tipoRegistro === 'audiencia') return c.audiencia;
  if (['concluido'].includes(item.status)) return c.concluido;
  if (['cancelado'].includes(item.status)) return c.cancelado;
  if (item.prioridade === 'fatal' || item.fatal || item.prioridade === 'urgente') return c.fatal;
  if (item.tipoRegistro === 'tarefa') return c.tarefa;
  const s = situacaoPrazo(item);
  if (['vencido', 'hoje', 'critico'].includes(s)) return c.fatal;
  if (s === 'proximo') return c.proximo;
  return c.tarefa;
}

/** Prazos abertos ordenados por urgência, já enriquecidos para exibição. */
export function prazosAbertos(filtro = {}) {
  return listarPrazos({ ...filtro, status: abertos });
}

export function listarPrazos(filtro = {}) {
  let lista = db.listar('prazos');
  if (filtro.status) lista = lista.filter((p) => [].concat(filtro.status).includes(p.status));
  if (filtro.responsavelId) lista = lista.filter((p) => p.responsavelId === filtro.responsavelId);
  if (filtro.processoId) lista = lista.filter((p) => p.processoId === filtro.processoId);
  if (filtro.clienteId) lista = lista.filter((p) => p.clienteId === filtro.clienteId);
  if (filtro.de) lista = lista.filter((p) => p.dataVencimento >= filtro.de);
  if (filtro.ate) lista = lista.filter((p) => p.dataVencimento <= filtro.ate);
  return ordenarPor(lista, 'dataVencimento', 'prioridade:desc');
}

export function enriquecerPrazo(p) {
  const proc = processoDe(p.processoId);
  return {
    ...p,
    situacao: situacaoPrazo(p),
    processo: proc,
    numeroCNJ: proc ? fmtCNJ(proc.numeroCNJ) : '—',
    clienteNome: nomeCliente(p.clienteId || proc?.clienteId),
    responsavelNome: nomeUsuario(p.responsavelId),
    tipoRotulo: tipoPrazo(p.tipo).rotulo,
    diasRestantes: diffDias(hoje(), p.dataVencimento),
    diasUteisRestantes: diasUteisAte(p.dataVencimento, hoje(),
      { uf: proc?.uf, municipio: proc?.comarca, tribunal: proc?.tribunal },
      calendarioConfigurado()),
  };
}

export function calendarioConfigurado() {
  return {
    feriados: db.listar('feriados'),
    suspensoes: db.listar('suspensoes'),
    recessoForense: db.config().recessoForense !== false,
  };
}

/* --------------------------------------------- prevenção de conflitos --- */

/**
 * Verifica situações que exigem confirmação do advogado antes de gravar.
 * O sistema alerta; nunca decide sozinho nem sobrescreve informação jurídica.
 */
export function conflitosDePrazo(dados, idAtual = null) {
  const avisos = [];
  const irmaos = db.listar('prazos')
    .filter((p) => p.processoId === dados.processoId && p.id !== idAtual && abertos.includes(p.status));

  const mesmaData = irmaos.filter((p) => p.dataVencimento === dados.dataVencimento);
  if (mesmaData.length) {
    avisos.push({
      nivel: 'atencao',
      texto: `Já existe prazo cadastrado para este processo em ${fmtData(dados.dataVencimento)}: `
        + mesmaData.map((p) => tipoPrazo(p.tipo).rotulo).join(', ') + '.',
    });
  }
  const mesmoTipo = irmaos.filter((p) => p.tipo === dados.tipo && p.dataVencimento !== dados.dataVencimento);
  if (mesmoTipo.length) {
    avisos.push({
      nivel: 'atencao',
      texto: `Este processo possui outro prazo pendente do mesmo tipo, com vencimento em `
        + `${fmtData(mesmoTipo[0].dataVencimento)}.`,
    });
  }
  if (irmaos.length && !mesmaData.length && !mesmoTipo.length) {
    avisos.push({ nivel: 'info', texto: `Este processo possui ${irmaos.length} prazo(s) pendente(s).` });
  }
  if (dados.dataVencimento && dados.dataVencimento < hoje()) {
    avisos.push({ nivel: 'alerta', texto: 'A data de vencimento informada já passou.' });
  }
  if (dados.dataInicio && dados.dataVencimento && dados.dataInicio > dados.dataVencimento) {
    avisos.push({ nivel: 'alerta', texto: 'O termo inicial é posterior ao vencimento.' });
  }
  return avisos;
}

/** O número CNJ é o identificador jurídico do processo e não admite duplicidade. */
export function processoPorNumero(numero, ignorarId = null) {
  const alvo = cnjDigitos(numero);
  return db.listar('processos')
    .find((p) => cnjDigitos(p.numeroCNJ) === alvo && p.id !== ignorarId) || null;
}

/* --------------------------------------------------------------- agenda -- */

/** Unifica prazos, tarefas e audiências em eventos de agenda. */
export function eventosAgenda({ de, ate, filtros = {} } = {}) {
  const dentro = (d) => (!de || d >= de) && (!ate || d <= ate);
  const eventos = [];

  if (filtros.tipo !== 'tarefas' && filtros.tipo !== 'audiencias') {
    for (const p of db.listar('prazos')) {
      if (!dentro(p.dataVencimento)) continue;
      eventos.push({
        id: p.id, tipoRegistro: 'prazo', data: p.dataVencimento, hora: null,
        titulo: `${tipoPrazo(p.tipo).rotulo}${p.descricao ? ` — ${p.descricao}` : ''}`,
        processoId: p.processoId, clienteId: p.clienteId, responsavelId: p.responsavelId,
        prioridade: p.prioridade, status: p.status, fatal: p.fatal,
        situacao: situacaoPrazo(p), rota: `#/prazos/${p.id}`, origem: p,
      });
    }
  }
  if (filtros.tipo !== 'prazos' && filtros.tipo !== 'audiencias') {
    for (const t of db.listar('tarefas')) {
      if (!t.dataVencimento || !dentro(t.dataVencimento)) continue;
      eventos.push({
        id: t.id, tipoRegistro: 'tarefa', data: t.dataVencimento, hora: null,
        titulo: t.titulo, processoId: t.processoId, clienteId: t.clienteId,
        responsavelId: t.responsavelId, prioridade: t.prioridade, status: t.status,
        situacao: situacaoPrazo({ ...t, dataVencimento: t.dataVencimento }),
        rota: `#/tarefas/${t.id}`, origem: t,
      });
    }
  }
  if (filtros.tipo !== 'prazos' && filtros.tipo !== 'tarefas') {
    for (const a of db.listar('audiencias')) {
      if (!dentro(a.data)) continue;
      eventos.push({
        id: a.id, tipoRegistro: 'audiencia', data: a.data, hora: a.hora,
        titulo: `Audiência ${a.modalidade || ''}`.trim(), processoId: a.processoId,
        clienteId: a.clienteId, responsavelId: a.responsavelId,
        prioridade: 'importante', status: a.status || 'pendente',
        situacao: situacaoPrazo({ ...a, dataVencimento: a.data, status: a.status }),
        rota: `#/audiencias/${a.id}`, origem: a,
      });
    }
  }

  let lista = eventos;
  if (filtros.responsavelId) lista = lista.filter((e) => e.responsavelId === filtros.responsavelId);
  if (filtros.clienteId) lista = lista.filter((e) => e.clienteId === filtros.clienteId);
  if (filtros.processoId) lista = lista.filter((e) => e.processoId === filtros.processoId);
  if (filtros.urgentes) lista = lista.filter((e) => ['fatal', 'urgente'].includes(e.prioridade));
  if (filtros.vencidos) lista = lista.filter((e) => e.situacao === 'vencido');
  if (filtros.pendentes) lista = lista.filter((e) => abertos.includes(e.status));
  if (filtros.ocultarConcluidos) lista = lista.filter((e) => e.status !== 'concluido');

  return ordenarPor(lista, 'data', 'hora');
}

/* --------------------------------------------------------- indicadores -- */

export function indicadores(ref = hoje()) {
  const prazos = db.listar('prazos');
  const tarefas = db.listar('tarefas');
  const audiencias = db.listar('audiencias');
  const em7 = addDays(ref, 7);

  const prazoAberto = (p) => abertos.includes(p.status);
  const tarefaAberta = (t) => abertos.includes(t.status);

  return {
    prazosHoje: prazos.filter((p) => prazoAberto(p) && p.dataVencimento === ref).length,
    tarefasHoje: tarefas.filter((t) => tarefaAberta(t) && t.dataVencimento === ref).length,
    audienciasHoje: audiencias.filter((a) => a.data === ref && a.status !== 'cancelada').length,
    prazos7: prazos.filter((p) => prazoAberto(p) && p.dataVencimento > ref && p.dataVencimento <= em7).length,
    tarefas7: tarefas.filter((t) => tarefaAberta(t) && t.dataVencimento > ref && t.dataVencimento <= em7).length,
    audiencias7: audiencias.filter((a) => a.data > ref && a.data <= em7 && a.status !== 'cancelada').length,
    vencidos: prazos.filter((p) => prazoAberto(p) && p.dataVencimento < ref).length,
    tarefasVencidas: tarefas.filter((t) => tarefaAberta(t) && t.dataVencimento && t.dataVencimento < ref).length,
    publicacoesPendentes: db.listar('publicacoes').filter((p) => p.status === 'pendente').length,
    processosAtivos: db.listar('processos').filter((p) => p.status === 'ativo').length,
    processosTotal: db.listar('processos').length,
    clientesAtivos: db.listar('clientes').filter((c) => c.ativo !== false).length,
    tarefasPendentes: tarefas.filter(tarefaAberta).length,
    fatais: prazos.filter((p) => prazoAberto(p) && (p.fatal || p.prioridade === 'fatal')).length,
  };
}

/** Painel "O que preciso fazer hoje?". */
export function pautaDoDia(ref = hoje()) {
  const prazos = db.listar('prazos').filter((p) => abertos.includes(p.status));
  const tarefas = db.listar('tarefas').filter((t) => abertos.includes(t.status));
  return {
    vencidos: ordenarPor(prazos.filter((p) => p.dataVencimento < ref), 'dataVencimento').map(enriquecerPrazo),
    hoje: prazos.filter((p) => p.dataVencimento === ref).map(enriquecerPrazo),
    proximos3: ordenarPor(prazos.filter((p) => p.dataVencimento > ref && p.dataVencimento <= addDays(ref, 3)),
      'dataVencimento').map(enriquecerPrazo),
    publicacoes: db.listar('publicacoes').filter((p) => p.status === 'pendente'),
    audienciasHoje: db.listar('audiencias').filter((a) => a.data === ref),
    audienciasSemana: db.listar('audiencias').filter((a) => a.data > ref && a.data <= addDays(ref, 7)),
    tarefas: ordenarPor(tarefas.filter((t) => !t.dataVencimento || t.dataVencimento <= addDays(ref, 3)), 'dataVencimento'),
    clientesParaInformar: clientesSemComunicacaoRecente(ref),
  };
}

function clientesSemComunicacaoRecente(ref, dias = 30) {
  const limite = addDays(ref, -dias);
  const comunicacoes = db.listar('comunicacoes');
  return db.listar('clientes').filter((c) => {
    const processos = db.listar('processos').filter((p) => p.clienteId === c.id && p.status === 'ativo');
    if (!processos.length) return false;
    const ultima = comunicacoes.filter((m) => m.clienteId === c.id)
      .map((m) => (m.enviadoEm || '').slice(0, 10)).sort().at(-1);
    return !ultima || ultima < limite;
  });
}

/* ---------------------------------------------------------- alertas ----- */

/**
 * Gera os alertas devidos para a data de referência, com base na régua de
 * antecedência de cada prazo (ou na régua padrão do escritório).
 */
export function alertasDevidos(ref = hoje()) {
  const padrao = db.config().alertasPadrao || [7, 5, 3, 1, 0];
  const alertas = [];

  for (const p of db.listar('prazos')) {
    if (!abertos.includes(p.status)) continue;
    const regua = (p.alertas && p.alertas.length ? p.alertas : padrao);
    const faltam = diffDias(ref, p.dataVencimento);
    if (faltam < 0) {
      alertas.push({ chave: `prazo:${p.id}:vencido:${ref}`, nivel: 'critico', tipo: 'prazo',
        titulo: 'Prazo vencido e não concluído', item: enriquecerPrazo(p), rota: `#/prazos/${p.id}` });
    } else if (regua.includes(faltam)) {
      alertas.push({
        chave: `prazo:${p.id}:${faltam}:${ref}`,
        nivel: faltam === 0 ? 'critico' : (faltam <= 3 ? 'alto' : 'medio'),
        tipo: 'prazo',
        titulo: faltam === 0 ? 'Prazo vence hoje' : `Prazo em ${faltam} dia(s)`,
        item: enriquecerPrazo(p), rota: `#/prazos/${p.id}`,
      });
    }
  }

  for (const a of db.listar('audiencias')) {
    if (a.status === 'cancelada') continue;
    const faltam = diffDias(ref, a.data);
    if ([0, 1, 3, 7].includes(faltam)) {
      alertas.push({
        chave: `audiencia:${a.id}:${faltam}:${ref}`,
        nivel: faltam <= 1 ? 'alto' : 'medio', tipo: 'audiencia',
        titulo: faltam === 0 ? 'Audiência hoje' : `Audiência em ${faltam} dia(s)`,
        item: a, rota: `#/audiencias/${a.id}`,
      });
    }
  }

  const pendentes = db.listar('publicacoes').filter((p) => p.status === 'pendente');
  if (pendentes.length) {
    alertas.push({
      chave: `publicacoes:${ref}:${pendentes.length}`, nivel: 'medio', tipo: 'publicacao',
      titulo: `${pendentes.length} publicação(ões) aguardando conferência`,
      item: null, rota: '#/publicacoes',
    });
  }
  return alertas;
}

/** Converte alertas em notificações persistidas, sem duplicar. */
export function sincronizarNotificacoes(ref = hoje()) {
  const existentes = new Set(db.listar('notificacoes').map((n) => n.chave));
  let novas = 0;
  for (const a of alertasDevidos(ref)) {
    if (existentes.has(a.chave)) continue;
    db.inserir('notificacoes', {
      chave: a.chave, nivel: a.nivel, tipo: a.tipo, titulo: a.titulo,
      mensagem: a.item ? descreverItemAlerta(a) : 'Fila de conferência com itens pendentes.',
      rota: a.rota, data: new Date().toISOString(), lida: false,
    });
    novas += 1;
  }
  return novas;
}

function descreverItemAlerta(a) {
  const i = a.item;
  if (a.tipo === 'prazo') {
    return `${i.tipoRotulo} · ${i.numeroCNJ} · ${i.clienteNome} · vencimento ${fmtData(i.dataVencimento)} · `
      + `responsável ${i.responsavelNome}`;
  }
  return `${rotuloProcesso(i.processoId)} · ${fmtData(i.data)} ${i.hora || ''} · ${i.modalidade || ''}`;
}

/* --------------------------------------------------- linha do tempo ----- */

export function linhaDoTempo(processoId) {
  const p = processoDe(processoId);
  if (!p) return [];
  const itens = [];
  const add = (data, tipo, titulo, detalhe, rota) => data && itens.push({ data, tipo, titulo, detalhe, rota });

  add(p.dataDistribuicao, 'processo', 'Distribuição',
    `${p.classe || 'Processo'} distribuído${p.vara ? ` na ${p.vara}` : ''}`, null);

  for (const pub of db.listar('publicacoes', { processoId })) {
    add(pub.dataPublicacao, 'publicacao', 'Publicação recebida',
      pub.conteudo, `#/publicacoes/${pub.id}`);
  }
  for (const pr of db.listar('prazos', { processoId })) {
    add(pr.criadoEm?.slice(0, 10) || pr.dataInicio, 'prazo', 'Prazo cadastrado',
      `${tipoPrazo(pr.tipo).rotulo} — vencimento em ${fmtData(pr.dataVencimento)}`, `#/prazos/${pr.id}`);
    if (pr.status === 'concluido') {
      add((pr.concluidoEm || '').slice(0, 10), 'concluido', 'Prazo concluído',
        `${tipoPrazo(pr.tipo).rotulo}${pr.observacoes ? ` — ${pr.observacoes}` : ''}`, `#/prazos/${pr.id}`);
    }
    if (pr.fatal) add(pr.dataVencimento, 'fatal', 'Prazo fatal', tipoPrazo(pr.tipo).rotulo, `#/prazos/${pr.id}`);
  }
  for (const a of db.listar('audiencias', { processoId })) {
    add(a.data, 'audiencia', 'Audiência', `${a.modalidade || ''} ${a.hora || ''}`.trim(), `#/audiencias/${a.id}`);
  }
  for (const t of db.listar('tarefas', { processoId })) {
    add(t.dataVencimento || t.criadoEm?.slice(0, 10), 'tarefa', 'Tarefa', t.titulo, `#/tarefas/${t.id}`);
  }
  for (const d of db.listar('documentos', { processoId })) {
    add(d.criadoEm?.slice(0, 10), 'documento', `Documento — ${d.categoria}`, d.nome, `#/documentos`);
  }
  for (const m of db.listar('movimentacoes', { processoId })) {
    add(m.data, 'movimentacao', m.titulo || 'Movimentação', m.descricao, null);
  }
  for (const c of db.listar('comunicacoes', { processoId })) {
    add((c.enviadoEm || '').slice(0, 10), 'comunicacao',
      `Comunicação — ${c.canal}`, c.mensagem, '#/comunicacoes');
  }
  return ordenarPor(itens, 'data:desc');
}

/* ------------------------------------------------- visão do cliente ----- */

export function panoramaCliente(clienteId) {
  const processos = db.listar('processos', { clienteId });
  const ativos = processos.filter((p) => p.status === 'ativo');
  const encerrados = processos.filter((p) => ['encerrado', 'arquivado'].includes(p.status));
  const ids = processos.map((p) => p.id);
  const prazos = db.listar('prazos').filter((p) => ids.includes(p.processoId) && abertos.includes(p.status));
  const audiencias = db.listar('audiencias').filter((a) => ids.includes(a.processoId) && a.data >= hoje());
  return {
    cliente: clienteDe(clienteId),
    processos, ativos, encerrados,
    prazos: ordenarPor(prazos, 'dataVencimento').map(enriquecerPrazo),
    audiencias: ordenarPor(audiencias, 'data'),
    tarefas: db.listar('tarefas').filter((t) => t.clienteId === clienteId && abertos.includes(t.status)),
    documentos: db.listar('documentos', { clienteId }),
    comunicacoes: ordenarPor(db.listar('comunicacoes', { clienteId }), 'enviadoEm:desc'),
    financeiro: db.listar('financeiro', { clienteId }),
  };
}

/* -------------------------------------------------------- busca global -- */

export function buscaGlobal(termo) {
  const q = norm(termo);
  const qDigitos = String(termo || '').replace(/\D/g, '');
  if (q.length < 2 && qDigitos.length < 3) return [];
  const res = [];
  const bate = (...campos) => campos.some((c) => norm(c).includes(q));

  for (const c of db.listar('clientes')) {
    if (bate(c.nome, c.email, c.tipoCliente) || (qDigitos && String(c.documento || '').replace(/\D/g, '').includes(qDigitos))) {
      res.push({ tipo: 'Cliente', titulo: c.nome, detalhe: c.documento || c.email || '', rota: `#/clientes/${c.id}` });
    }
  }
  for (const p of db.listar('processos')) {
    const numero = cnjDigitos(p.numeroCNJ);
    if (bate(p.assunto, p.poloAtivo, p.poloPassivo, p.vara, p.tribunal, p.comarca, p.classe)
      || (qDigitos && numero.includes(qDigitos))) {
      res.push({
        tipo: 'Processo', titulo: fmtCNJ(p.numeroCNJ),
        detalhe: `${p.assunto || p.classe || ''} · ${nomeCliente(p.clienteId)}`, rota: `#/processos/${p.id}`,
      });
    }
  }
  for (const p of db.listar('prazos')) {
    if (bate(p.descricao, tipoPrazo(p.tipo).rotulo, p.observacoes)) {
      res.push({
        tipo: 'Prazo', titulo: `${tipoPrazo(p.tipo).rotulo} — ${fmtData(p.dataVencimento)}`,
        detalhe: rotuloProcesso(p.processoId), rota: `#/prazos/${p.id}`,
      });
    }
  }
  for (const t of db.listar('tarefas')) {
    if (bate(t.titulo, t.observacao)) {
      res.push({ tipo: 'Tarefa', titulo: t.titulo, detalhe: rotuloProcesso(t.processoId), rota: `#/tarefas/${t.id}` });
    }
  }
  for (const a of db.listar('audiencias')) {
    if (bate(a.modalidade, a.endereco, a.observacoes)) {
      res.push({ tipo: 'Audiência', titulo: `${fmtData(a.data)} ${a.hora || ''}`,
        detalhe: rotuloProcesso(a.processoId), rota: `#/audiencias/${a.id}` });
    }
  }
  for (const d of db.listar('documentos')) {
    if (bate(d.nome, d.categoria, d.pasta)) {
      res.push({ tipo: 'Documento', titulo: d.nome, detalhe: d.categoria, rota: '#/documentos' });
    }
  }
  for (const pub of db.listar('publicacoes')) {
    if (bate(pub.conteudo, pub.diario) || (qDigitos && cnjDigitos(pub.numeroCNJ).includes(qDigitos))) {
      res.push({ tipo: 'Publicação', titulo: fmtCNJ(pub.numeroCNJ),
        detalhe: fmtData(pub.dataPublicacao), rota: `#/publicacoes/${pub.id}` });
    }
  }
  return res.slice(0, 40);
}

/* ----------------------------------------------------- ações de prazo --- */

export function concluirPrazo(id, observacao) {
  const atual = db.obter('prazos', id);
  const mudancas = { status: 'concluido', concluidoEm: new Date().toISOString() };
  if (observacao) {
    mudancas.observacoes = [atual?.observacoes, observacao].filter(Boolean).join('\n');
  }
  return db.atualizar('prazos', id, mudancas, 'Prazo concluído');
}

export function reabrirPrazo(id) {
  return db.atualizar('prazos', id, { status: 'pendente', concluidoEm: null }, 'Prazo reaberto');
}

export function duplicarPrazo(id) {
  const p = db.obter('prazos', id);
  if (!p) return null;
  const { id: _i, criadoEm, atualizadoEm, concluidoEm, ...resto } = p;
  return db.inserir('prazos', { ...resto, status: 'pendente' }, 'Prazo duplicado');
}

/* ------------------------------------------------- relatórios gerenciais */

export function relatorioGerencial({ de, ate } = {}) {
  const dentro = (d) => d && (!de || d >= de) && (!ate || d <= ate);
  const prazos = db.listar('prazos');
  const usuarios = db.listar('usuarios');
  const processos = db.listar('processos');

  return {
    processosAtivos: processos.filter((p) => p.status === 'ativo').length,
    processosPorCliente: db.listar('clientes').map((c) => ({
      nome: c.nome, total: processos.filter((p) => p.clienteId === c.id).length,
      ativos: processos.filter((p) => p.clienteId === c.id && p.status === 'ativo').length,
    })).filter((x) => x.total).sort((a, b) => b.total - a.total),
    cargaPorAdvogado: usuarios.map((u) => ({
      nome: u.nome,
      prazosAbertos: prazos.filter((p) => p.responsavelId === u.id && abertos.includes(p.status)).length,
      concluidos: prazos.filter((p) => p.responsavelId === u.id && p.status === 'concluido'
        && dentro((p.concluidoEm || '').slice(0, 10))).length,
      tarefas: db.listar('tarefas').filter((t) => t.responsavelId === u.id && abertos.includes(t.status)).length,
      processos: processos.filter((p) => p.responsavelId === u.id).length,
    })),
    prazosNoPeriodo: prazos.filter((p) => dentro(p.dataVencimento)).length,
    concluidos: prazos.filter((p) => p.status === 'concluido' && dentro((p.concluidoEm || '').slice(0, 10))).length,
    vencidos: prazos.filter((p) => abertos.includes(p.status) && p.dataVencimento < hoje()).length,
    audiencias: db.listar('audiencias').filter((a) => dentro(a.data)).length,
    publicacoes: db.listar('publicacoes').filter((p) => dentro(p.dataPublicacao)).length,
    tarefasPendentes: db.listar('tarefas').filter((t) => abertos.includes(t.status)).length,
  };
}
