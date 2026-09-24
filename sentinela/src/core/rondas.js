// Rondas de atualização processual.
//
// O acompanhamento não pode depender de alguém lembrar de clicar em "atualizar"
// processo a processo. Três vezes ao dia — manhã, tarde e noite — o sistema
// percorre os processos ativos, consulta o tribunal e avisa o que mudou.
//
// A ronda corre no próprio navegador, enquanto o sistema está aberto. Por isso
// a janela é ampla (manhã, tarde, noite) e não horário fixo: basta abrir o
// sistema uma vez dentro dela para a ronda acontecer, e quem abre uma única vez
// ao dia tem a ronda daquela janela — não precisa estar presente nas três.

import { db, modoAtual } from './store.js';
import { hoje, iso, addDays, fmtCNJ, fmtData } from './util.js';
import { atualizarPeloTribunal } from './integracoes.js';
import { ponteDisponivel } from './ponte.js';

export const JANELAS = [
  { id: 'manha', rotulo: 'manhã', inicio: 5, fim: 12 },
  { id: 'tarde', rotulo: 'tarde', inicio: 12, fim: 18 },
  { id: 'noite', rotulo: 'noite', inicio: 18, fim: 24 },
];

// Processos por ronda. O limite existe para não disparar consultas sem fim ao
// tribunal, não para repartir o acompanhamento: quem abre o sistema uma vez por
// dia precisa que essa única ronda cubra a carteira inteira, sob pena de o
// processo excedente ficar dias sem conferência. Com a espera entre consultas,
// este teto leva cerca de um minuto, em segundo plano.
const POR_RONDA = 60;
const ESPERA_MS = 900;

/**
 * Janela a que o instante pertence.
 *
 * A madrugada pertence à noite do dia anterior: quem abre o sistema às duas da
 * manhã ainda não teve a ronda noturna daquele dia.
 */
export function janelaDe(agora = new Date()) {
  const hora = agora.getHours();
  // Data local, não a de Greenwich: às 21h de Recife já é o dia seguinte em UTC,
  // e a ronda da noite passaria a contar para o dia errado.
  const dia = iso(agora);
  if (hora < JANELAS[0].inicio) {
    return { ...JANELAS[2], dia: addDays(dia, -1), chave: `${addDays(dia, -1)}:noite` };
  }
  const janela = JANELAS.find((j) => hora >= j.inicio && hora < j.fim) || JANELAS[2];
  return { ...janela, dia, chave: `${dia}:${janela.id}` };
}

const configRondas = () => db.config().integracoes.tribunais?.rondas || {};

export function registrarRonda(dados) {
  const cfg = db.config().integracoes;
  db.salvarConfig({ integracoes: { ...cfg,
    tribunais: { ...cfg.tribunais, rondas: { ...configRondas(), ...dados } } } });
}

/**
 * Quando o processo foi verificado pela última vez.
 *
 * Conta também a tentativa que falhou: processo cuja consulta não vai adiante
 * — tribunal sem índice, número que a base não tem — ficaria para sempre à
 * frente da fila e consumiria as vagas de todas as rondas.
 */
const verificadoEm = (p) =>
  [p.ultimaConsultaTribunal, p.ultimaTentativaTribunal].filter(Boolean).sort().at(-1) || '';

/** Processos em acompanhamento, do que está sem verificação há mais tempo. */
export function filaDaRonda(limite = POR_RONDA) {
  return db.listar('processos')
    .filter((p) => p.status === 'ativo')
    .sort((a, b) => verificadoEm(a).localeCompare(verificadoEm(b)))
    .slice(0, Math.max(0, limite));
}

/**
 * Diz se a ronda desta janela ainda não correu.
 *
 * @returns {{devida:boolean, motivo:string|null, janela:object}}
 */
export function rondaDevida(agora = new Date()) {
  const janela = janelaDe(agora);
  const cfg = configRondas();

  if (cfg.ativo === false) return { devida: false, motivo: 'desligada', janela };
  if (modoAtual() !== 'servidor' && !ponteDisponivel()) {
    return { devida: false, motivo: 'sem ponte de consultas', janela };
  }
  if (cfg.ultimaChave === janela.chave) return { devida: false, motivo: 'já feita', janela };
  if (!filaDaRonda().length) return { devida: false, motivo: 'nenhum processo ativo', janela };
  return { devida: true, motivo: null, janela };
}

/**
 * Percorre a fila, consulta o tribunal e avisa o que mudou.
 *
 * A ronda é marcada como feita mesmo quando o tribunal não responde: insistir na
 * mesma janela a cada abertura da tela transformaria falha de rede em enxurrada
 * de consultas. A janela seguinte tenta de novo.
 */
export async function executarRonda({ agora = new Date(), aoProgresso = null, sinal = null } = {}) {
  const janela = janelaDe(agora);
  const fila = filaDaRonda();
  const novidades = [];
  const falhas = [];

  for (const [i, processo] of fila.entries()) {
    if (sinal?.aborted) break;
    aoProgresso?.({ atual: i + 1, total: fila.length, processo });
    try {
      const r = await atualizarPeloTribunal(processo.id, { sinal });
      if (!r.ok) {
        marcarTentativa(processo.id);
        falhas.push({ processo, motivo: r.motivo });
        continue;
      }
      if (r.importados > 0) novidades.push({ processo, importados: r.importados, capa: r.capa });
    } catch (e) {
      marcarTentativa(processo.id);
      falhas.push({ processo, motivo: e.message });
    }
    if (i < fila.length - 1) await new Promise((r) => setTimeout(r, ESPERA_MS));
  }

  const avisadas = novidades.map((n) => avisarNovidade(n)).filter(Boolean).length;
  registrarRonda({
    ultimaChave: janela.chave,
    ultimaEm: new Date().toISOString(),
    ultimaJanela: janela.rotulo,
    consultados: fila.length,
    comNovidade: novidades.length,
    semResposta: falhas.length,
  });

  return { janela, consultados: fila.length, novidades, falhas, avisadas };
}

/** A tentativa frustrada também conta como verificação, para a fila girar. */
const marcarTentativa = (processoId) =>
  db.atualizar('processos', processoId, { ultimaTentativaTribunal: hoje() },
    'Consulta ao tribunal sem resposta');

/**
 * Registra a novidade na central de notificações.
 *
 * A chave inclui a data do último movimento importado: a mesma novidade não
 * volta a notificar na ronda seguinte, e movimento novo gera aviso novo.
 */
export function avisarNovidade({ processo, importados }) {
  const movimentos = db.listar('movimentacoes', { processoId: processo.id })
    .filter((m) => m.data)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const ultimo = movimentos.at(-1);
  const chave = `movimentacao:${processo.id}:${ultimo?.data || hoje()}:${movimentos.length}`;

  if (db.listar('notificacoes').some((n) => n.chave === chave)) return null;

  return db.inserir('notificacoes', {
    chave,
    nivel: 'alto',
    tipo: 'movimentacao',
    titulo: `Movimentação nova — ${fmtCNJ(processo.numeroCNJ)}`,
    mensagem: `${importados} movimento(s) importado(s) do tribunal.`
      + (ultimo ? ` Último: ${ultimo.titulo} em ${fmtData(ultimo.data)}.` : ''),
    rota: `#/processos/${processo.id}`,
    data: new Date().toISOString(),
    lida: false,
  });
}

/**
 * Aviso do sistema operacional, quando o usuário o autorizou.
 *
 * É o que alcança quem está com o sistema aberto em outra aba. Sem permissão,
 * nada se faz: pedir autorização no meio do trabalho é intromissão.
 */
export function avisarNoDispositivo(novidades) {
  if (!novidades.length) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;

  const titulo = novidades.length === 1
    ? `Movimentação em ${fmtCNJ(novidades[0].processo.numeroCNJ)}`
    : `${novidades.length} processos com movimentação nova`;
  const corpo = novidades.slice(0, 3)
    .map((n) => `${fmtCNJ(n.processo.numeroCNJ)} — ${n.importados} movimento(s)`)
    .join('\n');
  try {
    new Notification(titulo, { body: corpo, tag: 'jursistemy-movimentacao' });
    return true;
  } catch {
    return false;
  }
}

/** Situação das rondas, para a tela de configurações. */
export function situacaoDasRondas(agora = new Date()) {
  const cfg = configRondas();
  const { devida, motivo, janela } = rondaDevida(agora);
  return {
    ativo: cfg.ativo !== false,
    janela,
    devida,
    motivo,
    ultimaEm: cfg.ultimaEm || null,
    ultimaJanela: cfg.ultimaJanela || null,
    consultados: cfg.consultados || 0,
    comNovidade: cfg.comNovidade || 0,
    semResposta: cfg.semResposta || 0,
    emAcompanhamento: db.listar('processos').filter((p) => p.status === 'ativo').length,
    porRonda: POR_RONDA,
  };
}
