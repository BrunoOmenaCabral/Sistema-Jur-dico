// Camada de persistência.
//
// Opera em dois modos, com a mesma interface `db` para todo o restante do
// sistema:
//
// - servidor: os dados vivem no backend. A memória do navegador guarda uma
//   cópia de trabalho, as leituras são imediatas e cada gravação vira uma
//   mutação enviada ao servidor, com fila que sobrevive à queda de conexão.
// - local: sem backend, tudo fica no armazenamento do navegador. É o modo de
//   demonstração e o de contingência.

import { uid, hoje } from './util.js';
import { api } from './api.js';

const CHAVE = 'sentinela.dados.v1';
const CHAVE_SESSAO = 'sentinela.sessao.v1';
const CHAVE_FILA = 'sentinela.fila.v1';

export const COLECOES = [
  'usuarios', 'clientes', 'processos', 'prazos', 'tarefas', 'audiencias',
  'publicacoes', 'documentos', 'comunicacoes', 'financeiro', 'movimentacoes',
  'auditoria', 'notificacoes', 'feriados', 'suspensoes',
];

// `auditoria` é gerada pelo servidor; `notificacoes` são o alerta pessoal de
// cada usuário e ficam apenas no dispositivo dele.
const COLECOES_LOCAIS = ['auditoria', 'notificacoes'];
const COLECOES_SINCRONIZADAS = COLECOES.filter((c) => !COLECOES_LOCAIS.includes(c));

const estadoInicial = () => ({
  versao: 1,
  configuracoes: configuracoesPadrao(),
  ...Object.fromEntries(COLECOES.map((c) => [c, []])),
});

export function configuracoesPadrao() {
  return {
    escritorio: { nome: 'Escritório de Advocacia', oab: '', email: '', telefone: '', whatsapp: '' },
    alertasPadrao: [7, 5, 3, 1, 0],
    recessoForense: true,
    cores: {
      fatal: '#e5484d',
      urgente: '#e5484d',
      proximo: '#f76b15',
      tarefa: '#f5d90a',
      audiencia: '#3b82f6',
      concluido: '#30a46c',
      cancelado: '#6b7280',
      publicacao: '#8b5cf6',
    },
    automacoesWhatsapp: {
      prazoProximo: { ativo: true, antecedencia: 3 },
      audiencia: { ativo: true, antecedencia: 2 },
      relatorioMensal: { ativo: false, dia: 1 },
    },
    integracoes: {
      publicacoes: { ativo: false, provedor: '', chave: '', dias: ['seg', 'qua', 'sex'], ultimaConsulta: null },
      ia: { ativo: false, provedor: 'heuristico', endpoint: '', chave: '', modelo: '' },
      whatsapp: { ativo: false, provedor: '', numero: '', token: '' },
      email: { ativo: false, remetente: '', servidor: '' },
      calendario: { ativo: false, provedor: '' },
    },
  };
}

let estado = null;
let modo = 'local';
let ultimaSincronizacao = null;
let fila = [];
let envioAgendado = null;
let enviando = false;
const ouvintes = new Set();
const observadoresSincronia = new Set();

export const modoAtual = () => modo;

function carregar() {
  if (estado) return estado;
  if (modo === 'servidor') { estado = estadoInicial(); return estado; }
  try {
    const bruto = localStorage.getItem(CHAVE);
    estado = bruto ? { ...estadoInicial(), ...JSON.parse(bruto) } : estadoInicial();
    estado.configuracoes = { ...configuracoesPadrao(), ...(estado.configuracoes || {}) };
  } catch (e) {
    console.error('Falha ao ler os dados locais. Iniciando base vazia.', e);
    estado = estadoInicial();
  }
  return estado;
}

const chaveNotificacoes = () => `sentinela.notificacoes.${sessao.obter()?.usuarioId || 'anonimo'}`;

function guardarNotificacoes() {
  try { localStorage.setItem(chaveNotificacoes(), JSON.stringify(estado.notificacoes.slice(0, 400))); }
  catch { /* alerta pessoal não é crítico */ }
}

function salvar() {
  if (modo === 'servidor') guardarNotificacoes();
  if (modo === 'local') {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch (e) {
      console.error('Não foi possível gravar os dados.', e);
      throw new Error('Armazenamento local cheio ou indisponível.');
    }
  }
  ouvintes.forEach((fn) => fn(estado));
}

export const aoMudar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

/** Observa o estado da sincronização: { pendentes, erro, sincronizadoEm }. */
export const aoSincronizar = (fn) => { observadoresSincronia.add(fn); return () => observadoresSincronia.delete(fn); };

const avisarSincronia = (info) => observadoresSincronia.forEach((fn) => fn(info));

/* --------------------------------------------------------------- sessão -- */

export const sessao = {
  obter() {
    try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || localStorage.getItem(CHAVE_SESSAO) || 'null'); }
    catch { return null; }
  },
  definir(valor, lembrar = true) {
    const s = JSON.stringify(valor);
    sessionStorage.setItem(CHAVE_SESSAO, s);
    if (lembrar) localStorage.setItem(CHAVE_SESSAO, s);
  },
  limpar() {
    sessionStorage.removeItem(CHAVE_SESSAO);
    localStorage.removeItem(CHAVE_SESSAO);
  },
};

/* ------------------------------------------------------------ auditoria -- */

function registrarAuditoria(colecao, id, acao, detalhe, antes, depois) {
  // No modo servidor a auditoria é responsabilidade do backend: ele é a fonte
  // confiável de quem alterou o quê.
  if (modo === 'servidor') return;
  if (colecao === 'auditoria' || colecao === 'notificacoes') return;
  estado.auditoria.unshift({
    id: uid('aud'),
    quando: new Date().toISOString(),
    usuarioId: sessao.obter()?.usuarioId || null,
    usuarioNome: sessao.obter()?.nome || 'Sistema',
    colecao, registroId: id, acao, detalhe,
    antes: antes ? resumir(antes) : null,
    depois: depois ? resumir(depois) : null,
  });
  if (estado.auditoria.length > 5000) estado.auditoria.length = 5000;
}

const resumir = (obj) => {
  const copia = { ...obj };
  delete copia.conteudoArquivo;
  return copia;
};

/* ----------------------------------------------- sincronização com API --- */

function carregarFila() {
  try { fila = JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]'); }
  catch { fila = []; }
}

function guardarFila() {
  try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); } catch { /* fila só em memória */ }
  avisarSincronia({ pendentes: fila.length, sincronizadoEm: ultimaSincronizacao });
}

function enfileirar(mutacao) {
  if (modo !== 'servidor' || COLECOES_LOCAIS.includes(mutacao.colecao)) return;
  fila.push({ ...mutacao, ref: uid('mut') });
  guardarFila();
  clearTimeout(envioAgendado);
  envioAgendado = setTimeout(() => { enviarFila(); }, 250);
}

/** Envia a fila pendente. Mantém o que não foi aceito para nova tentativa. */
export async function enviarFila() {
  if (modo !== 'servidor' || enviando || !fila.length) return { enviadas: 0 };
  enviando = true;
  const lote = fila.slice(0, 200);
  try {
    const r = await api.mutacoes(lote);
    fila = fila.slice(lote.length);
    guardarFila();

    for (const item of r.aplicadas) aplicarRegistroLocal(item.colecao, item.registro);
    if (r.auditoria?.length) {
      estado.auditoria = [...r.auditoria, ...estado.auditoria].slice(0, 5000);
    }
    ultimaSincronizacao = r.servidor?.agora || ultimaSincronizacao;
    salvar();

    if (r.recusadas?.length) {
      // O servidor é a autoridade: recarrega para desfazer o que ele não aceitou.
      await sincronizarCompleto();
      const erro = r.recusadas.map((x) => x.motivo).join(' ');
      avisarSincronia({ pendentes: fila.length, erro, sincronizadoEm: ultimaSincronizacao });
      return { enviadas: r.aplicadas.length, recusadas: r.recusadas };
    }
    avisarSincronia({ pendentes: fila.length, sincronizadoEm: ultimaSincronizacao });
    return { enviadas: r.aplicadas.length };
  } catch (e) {
    // Sem conexão ou sessão expirada: a fila permanece para nova tentativa.
    avisarSincronia({ pendentes: fila.length, erro: e.message, sincronizadoEm: ultimaSincronizacao });
    return { enviadas: 0, erro: e.message };
  } finally {
    enviando = false;
  }
}

function aplicarRegistroLocal(colecao, registro) {
  if (!registro || !estado[colecao]) return;
  if (registro.removidoDefinitivamente) {
    estado[colecao] = estado[colecao].filter((r) => r.id !== registro.id);
    return;
  }
  const i = estado[colecao].findIndex((r) => r.id === registro.id);
  if (i < 0) estado[colecao].push(registro);
  else estado[colecao][i] = registro;
}

/** Carrega o estado completo vindo do servidor. */
export function aplicarEstadoDoServidor(payload) {
  estado = estadoInicial();
  for (const c of COLECOES_SINCRONIZADAS) estado[c] = payload.colecoes?.[c] || [];
  estado.auditoria = payload.auditoria || [];
  try { estado.notificacoes = JSON.parse(localStorage.getItem(chaveNotificacoes()) || '[]'); }
  catch { estado.notificacoes = []; }
  estado.configuracoes = { ...configuracoesPadrao(), ...(payload.configuracoes || {}) };
  ultimaSincronizacao = payload.servidor?.agora || new Date().toISOString();
  salvar();
}

export async function sincronizarCompleto() {
  const payload = await api.estado();
  aplicarEstadoDoServidor(payload);
  return payload;
}

/** Busca apenas o que mudou desde a última conversa com o servidor. */
export async function sincronizarIncremental() {
  if (modo !== 'servidor') return { novidades: 0 };
  await enviarFila();
  try {
    const payload = await api.estado(ultimaSincronizacao);
    let novidades = 0;
    for (const [colecao, registros] of Object.entries(payload.colecoes || {})) {
      for (const r of registros) { aplicarRegistroLocal(colecao, r); novidades += 1; }
    }
    if (payload.auditoria?.length) {
      const conhecidos = new Set(estado.auditoria.map((a) => a.id));
      const novas = payload.auditoria.filter((a) => !conhecidos.has(a.id));
      estado.auditoria = [...novas, ...estado.auditoria].slice(0, 5000);
    }
    ultimaSincronizacao = payload.servidor?.agora || ultimaSincronizacao;
    if (novidades) salvar();
    avisarSincronia({ pendentes: fila.length, sincronizadoEm: ultimaSincronizacao });
    return { novidades };
  } catch (e) {
    avisarSincronia({ pendentes: fila.length, erro: e.message, sincronizadoEm: ultimaSincronizacao });
    return { novidades: 0, erro: e.message };
  }
}

/** Liga o modo servidor. Deve ser chamado antes de qualquer leitura. */
export function ativarModoServidor() {
  modo = 'servidor';
  estado = estadoInicial();
  carregarFila();
}

export const pendenciasDeEnvio = () => fila.length;

/* --------------------------------------------------------------- acesso -- */

export const db = {
  estado: () => carregar(),
  modo: () => modo,

  /** Lista registros ativos. `{ incluirExcluidos: true }` traz a lixeira. */
  listar(colecao, filtro = {}) {
    const dados = carregar()[colecao] || [];
    const lista = filtro.incluirExcluidos ? dados : dados.filter((r) => !r.excluidoEm);
    const criterios = Object.entries(filtro).filter(([k]) => k !== 'incluirExcluidos');
    if (!criterios.length) return lista;
    return lista.filter((r) => criterios.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
  },

  obter(colecao, id) {
    return (carregar()[colecao] || []).find((r) => r.id === id) || null;
  },

  inserir(colecao, dados, detalhe) {
    carregar();
    const registro = {
      ...dados,
      id: dados.id || uid(colecao.slice(0, 3)),
      criadoEm: new Date().toISOString(),
      criadoPor: sessao.obter()?.usuarioId || null,
      atualizadoEm: new Date().toISOString(),
    };
    estado[colecao].push(registro);
    registrarAuditoria(colecao, registro.id, 'criou', detalhe, null, registro);
    enfileirar({ op: 'inserir', colecao, dados: registro, detalhe });
    salvar();
    return registro;
  },

  atualizar(colecao, id, mudancas, detalhe) {
    carregar();
    const i = estado[colecao].findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Registro não encontrado.');
    const antes = { ...estado[colecao][i] };
    const depois = {
      ...antes, ...mudancas, id,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: sessao.obter()?.usuarioId || null,
    };
    estado[colecao][i] = depois;
    registrarAuditoria(colecao, id, 'alterou', detalhe || descreverMudancas(antes, mudancas), antes, depois);
    enfileirar({ op: 'atualizar', colecao, id, dados: mudancas, detalhe });
    salvar();
    return depois;
  },

  /** Exclusão lógica: o registro permanece recuperável na lixeira. */
  remover(colecao, id, motivo) {
    carregar();
    const i = estado[colecao].findIndex((r) => r.id === id);
    if (i < 0) return null;
    const antes = { ...estado[colecao][i] };
    estado[colecao][i] = {
      ...antes,
      excluidoEm: new Date().toISOString(),
      excluidoPor: sessao.obter()?.usuarioId || null,
      motivoExclusao: motivo || null,
    };
    registrarAuditoria(colecao, id, 'excluiu', motivo, antes, null);
    enfileirar({ op: 'remover', colecao, id, detalhe: motivo });
    salvar();
    return estado[colecao][i];
  },

  restaurar(colecao, id) {
    carregar();
    const i = estado[colecao].findIndex((r) => r.id === id);
    if (i < 0) return null;
    const { excluidoEm, excluidoPor, motivoExclusao, ...limpo } = estado[colecao][i];
    estado[colecao][i] = limpo;
    registrarAuditoria(colecao, id, 'restaurou', 'Registro recuperado da lixeira', null, limpo);
    enfileirar({ op: 'restaurar', colecao, id });
    salvar();
    return limpo;
  },

  /** Remoção física — exigida apenas em rotinas administrativas explícitas. */
  removerDefinitivo(colecao, id) {
    carregar();
    const antes = estado[colecao].find((r) => r.id === id);
    estado[colecao] = estado[colecao].filter((r) => r.id !== id);
    registrarAuditoria(colecao, id, 'excluiu definitivamente', 'Exclusão irreversível', antes, null);
    enfileirar({ op: 'removerDefinitivo', colecao, id });
    salvar();
  },

  config() { return carregar().configuracoes; },

  salvarConfig(mudancas) {
    carregar();
    estado.configuracoes = { ...estado.configuracoes, ...mudancas };
    registrarAuditoria('configuracoes', 'geral', 'alterou', 'Configurações do sistema', null, null);
    salvar();
    if (modo === 'servidor') {
      api.salvarConfiguracoes(estado.configuracoes)
        .catch((e) => avisarSincronia({ pendentes: fila.length, erro: e.message }));
    }
    return estado.configuracoes;
  },

  /* ------------------------------------------------------------ backup -- */

  exportar() {
    return JSON.stringify({ ...carregar(), exportadoEm: new Date().toISOString() }, null, 2);
  },

  importar(json, { substituir = false } = {}) {
    const dados = typeof json === 'string' ? JSON.parse(json) : json;
    carregar();
    if (substituir) {
      estado = { ...estadoInicial(), ...dados };
    } else {
      for (const c of COLECOES) {
        const existentes = new Set(estado[c].map((r) => r.id));
        for (const r of (dados[c] || [])) if (!existentes.has(r.id)) estado[c].push(r);
      }
      estado.configuracoes = { ...estado.configuracoes, ...(dados.configuracoes || {}) };
    }
    registrarAuditoria('sistema', 'backup', 'importou', substituir ? 'Restauração completa' : 'Mesclagem de backup');
    salvar();
  },

  zerar() {
    estado = estadoInicial();
    salvar();
  },

  /** Cópia de segurança automática mantida em chave separada. */
  backupAutomatico() {
    if (modo === 'servidor') return; // o backup passa a ser do servidor
    try {
      const marca = `sentinela.backup.${hoje()}`;
      if (!localStorage.getItem(marca)) {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('sentinela.backup.') && k !== marca) localStorage.removeItem(k);
        }
        localStorage.setItem(marca, localStorage.getItem(CHAVE) || '');
      }
    } catch (e) { console.warn('Backup automático não realizado.', e); }
  },
};

function descreverMudancas(antes, mudancas) {
  const campos = Object.keys(mudancas).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(mudancas[k]));
  return campos.length ? `Campos alterados: ${campos.join(', ')}` : 'Sem alterações efetivas';
}
