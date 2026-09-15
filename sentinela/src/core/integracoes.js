// Integrações externas em formato de adaptadores.
//
// Cada integração expõe a mesma assinatura e pode ser trocada por uma
// implementação oficial (API do WhatsApp Business, servidor SMTP, provedor de
// publicações, Google Calendar) sem tocar no restante do sistema. Enquanto o
// provedor não estiver configurado, o adaptador local resolve o essencial:
// abre o WhatsApp Web, o cliente de e-mail ou gera o arquivo para download.

import { db } from './store.js';
import { fmtCNJ, fmtData, iso, hoje, addDays, uid, norm, cnjDigitos } from './util.js';
import { processoDe, clienteDe, nomeCliente } from './dominio.js';
import { interpretarPublicacao, extrairNumerosCNJ } from './ia.js';
import { consultarPorOAB as consultarDJEN, agruparEmProcessos, comunicacaoComoPublicacao } from './djen.js';

/* -------------------------------------------------------------- arquivo -- */

export function baixarArquivo(nome, conteudo, tipo = 'text/plain;charset=utf-8') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------- whatsapp -- */

export const whatsapp = {
  disponivel: () => db.config().integracoes.whatsapp?.ativo === true,

  /** Envia pela API configurada ou, na ausência dela, abre o WhatsApp Web. */
  async enviar({ clienteId, processoId, mensagem, telefone }) {
    const cliente = clienteId ? clienteDe(clienteId) : null;
    const numero = String(telefone || cliente?.whatsapp || cliente?.telefone || '').replace(/\D/g, '');
    if (!numero) throw new Error('Cliente sem número de WhatsApp cadastrado.');
    const cfg = db.config().integracoes.whatsapp;
    let status = 'aberto_no_dispositivo';

    if (cfg?.ativo && cfg.provedor && cfg.token) {
      // Ponto de extensão: chamada à API oficial do provedor contratado.
      status = 'enviado_pela_api';
    } else {
      const url = `https://wa.me/${numero.length <= 11 ? `55${numero}` : numero}`
        + `?text=${encodeURIComponent(mensagem)}`;
      window.open(url, '_blank', 'noopener');
    }

    return db.inserir('comunicacoes', {
      clienteId, processoId, canal: 'whatsapp', direcao: 'saida',
      destinatario: numero, mensagem, status, enviadoEm: new Date().toISOString(),
    }, 'Mensagem de WhatsApp registrada');
  },
};

/* ---------------------------------------------------------------- email -- */

export const email = {
  disponivel: () => db.config().integracoes.email?.ativo === true,

  async enviar({ clienteId, processoId, assunto, mensagem, destinatario, anexoNome, anexoConteudo }) {
    const cliente = clienteId ? clienteDe(clienteId) : null;
    const para = destinatario || cliente?.email;
    if (!para) throw new Error('Cliente sem e-mail cadastrado.');
    const cfg = db.config().integracoes.email;
    let status = 'aberto_no_cliente_de_email';

    if (cfg?.ativo && cfg.servidor) {
      // Ponto de extensão: envio via servidor SMTP/API do escritório.
      status = 'enviado_pelo_servidor';
    } else {
      if (anexoConteudo) baixarArquivo(anexoNome || 'relatorio.txt', anexoConteudo);
      window.location.href = `mailto:${encodeURIComponent(para)}`
        + `?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`;
    }

    return db.inserir('comunicacoes', {
      clienteId, processoId, canal: 'email', direcao: 'saida', destinatario: para,
      assunto, mensagem, status, enviadoEm: new Date().toISOString(),
    }, 'E-mail registrado');
  },
};

/* ------------------------------------------------------------ calendário -- */

/**
 * Exporta prazos e audiências em iCalendar. A agenda do sistema permanece
 * como fonte única: a exportação é unidirecional, de modo que alteração feita
 * no calendário externo jamais modifica o prazo jurídico.
 */
export function gerarICS(eventos) {
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const carimbo = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const linhas = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sentinela//Gestao Juridica//PT-BR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  ];
  for (const e of eventos) {
    const dia = String(e.data).replace(/-/g, '');
    const hora = (e.hora || '').replace(':', '');
    linhas.push('BEGIN:VEVENT');
    linhas.push(`UID:${e.id || uid('ev')}@sentinela`);
    linhas.push(`DTSTAMP:${carimbo}`);
    if (hora) {
      linhas.push(`DTSTART:${dia}T${hora}00`);
      linhas.push(`DTEND:${dia}T${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}${hora.slice(2)}00`);
    } else {
      linhas.push(`DTSTART;VALUE=DATE:${dia}`);
      linhas.push(`DTEND;VALUE=DATE:${String(addDays(e.data, 1)).replace(/-/g, '')}`);
    }
    linhas.push(`SUMMARY:${esc(e.titulo)}`);
    linhas.push(`DESCRIPTION:${esc(e.descricao || '')}`);
    linhas.push('BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY',
      `DESCRIPTION:${esc(e.titulo)}`, 'END:VALARM');
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.join('\r\n');
}

export function exportarAgendaICS(eventos, nome = 'agenda-sentinela.ics') {
  const dados = eventos.map((e) => ({
    id: e.id, data: e.data, hora: e.hora,
    titulo: `${e.tipoRegistro === 'audiencia' ? 'Audiência' : e.tipoRegistro === 'tarefa' ? 'Tarefa' : 'Prazo'}: ${e.titulo}`,
    descricao: `${e.processoId ? fmtCNJ(processoDe(e.processoId)?.numeroCNJ) : ''} — ${nomeCliente(e.clienteId)}`,
  }));
  baixarArquivo(nome, gerarICS(dados), 'text/calendar;charset=utf-8');
}

/* ---------------------------------------------------------- publicações -- */

const DIAS_SEMANA_ID = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

export const publicacoes = {
  /** A rotina padrão de consulta ocorre às segundas, quartas e sextas. */
  devidaHoje(ref = hoje()) {
    const cfg = db.config().integracoes.publicacoes;
    const dia = DIAS_SEMANA_ID[new Date(`${ref}T12:00:00`).getDay()];
    return (cfg?.dias || ['seg', 'qua', 'sex']).includes(dia) && cfg?.ultimaConsulta !== ref;
  },

  /**
   * Consulta o provedor configurado. Sem provedor, o sistema apenas registra a
   * tentativa — nenhuma publicação fictícia é criada.
   * @returns {Promise<{importadas:number, ignoradas:number, mensagem:string}>}
   */
  async consultar({ ref = hoje(), lote = null } = {}) {
    const cfg = db.config().integracoes.publicacoes;
    let brutas = lote;

    if (!brutas) {
      if (!cfg?.ativo || !cfg.provedor) {
        return { importadas: 0, ignoradas: 0,
          mensagem: 'Nenhum provedor de publicações configurado. Utilize a importação manual.' };
      }
      // Ponto de extensão: requisição ao provedor de monitoramento contratado.
      brutas = [];
    }
    return this.importar(brutas, ref);
  },

  /** Recebe publicações brutas, associa ao processo e monta a fila de conferência. */
  importar(brutas, ref = hoje()) {
    let importadas = 0, ignoradas = 0;
    const existentes = db.listar('publicacoes');

    for (const bruta of brutas) {
      const duplicada = existentes.some((p) => p.hash === hashPublicacao(bruta));
      if (duplicada) { ignoradas += 1; continue; }

      const sugestao = interpretarPublicacao(bruta);
      db.inserir('publicacoes', {
        numeroCNJ: sugestao.numeroCNJ || bruta.numeroCNJ,
        processoId: sugestao.processoId,
        dataDisponibilizacao: bruta.dataDisponibilizacao || null,
        dataPublicacao: bruta.dataPublicacao || sugestao.dataPublicacao || ref,
        diario: bruta.diario || 'Importação manual',
        // Marca a procedência para que a linha do tempo distinga o que veio do
        // diário oficial do que foi lançado pelo escritório.
        origem: bruta.origem || 'DJEN',
        conteudo: bruta.conteudo,
        status: 'pendente',
        sugestao,
        hash: hashPublicacao(bruta),
      }, 'Publicação recebida');
      importadas += 1;
    }

    db.salvarConfig({
      integracoes: { ...db.config().integracoes,
        publicacoes: { ...db.config().integracoes.publicacoes, ultimaConsulta: ref } },
    });
    return { importadas, ignoradas,
      mensagem: `${importadas} publicação(ões) importada(s); ${ignoradas} já existente(s).` };
  },
};

/* --------------------------------------------------- consulta processual -- */

/**
 * Reconhece o processo já baixado em definitivo.
 *
 * Arquivamento provisório, suspensão e sobrestamento não entram aqui: o
 * processo continua vivo e precisa ser acompanhado. Só é descartado o que
 * teve baixa definitiva ou arquivamento definitivo.
 */
export function arquivadoEmDefinitivo(bruto) {
  const t = norm([bruto.status, bruto.situacao, bruto.fase, bruto.ultimoMovimento, bruto.movimento]
    .filter(Boolean).join(' '));
  if (!t) return false;
  if (/arquivad[oa]\s+provisori|suspens|sobrestad/.test(t)) return false;
  return /baixa definitiva|arquivamento definitivo|arquivad[oa]\s+(em\s+)?definitiv/.test(t)
    || (/arquivad/.test(t) && /transito em julgado|baixa dos autos/.test(t));
}

/**
 * Consulta processual pela inscrição na OAB.
 *
 * A fonte é a consulta pública do CNJ: o Diário de Justiça Eletrônico Nacional
 * publica as citações e intimações de todos os tribunais integrados e aceita
 * busca por OAB, sem certificado digital e sem cadastro. Os processos são
 * deduzidos das comunicações recebidas, porque é nelas que o advogado aparece
 * como destinatário.
 *
 * O que essa fonte não cobre: processos em segredo de justiça, tribunais ainda
 * não integrados ao DJEN e processos sem qualquer intimação no período
 * consultado. Para esses, resta a importação da lista exportada pelo tribunal.
 */
export const tribunais = {
  disponivel: () => true,

  async consultarPorOAB({ oab, uf, de = null, ate = null, sinal = null }) {
    const r = await consultarDJEN({ numeroOab: oab, ufOab: uf, de, ate, sinal });
    if (!r.ok) return { disponivel: false, processos: [], comunicacoes: [], motivo: r.motivo };

    const processos = agruparEmProcessos(r.comunicacoes);
    return {
      disponivel: true,
      motivo: null,
      processos,
      comunicacoes: r.comunicacoes,
      total: r.total,
    };
  },

  /** Traz as comunicações do período para a fila de conferência de publicações. */
  importarComunicacoes(comunicacoes, ref = hoje()) {
    return publicacoes.importar(comunicacoes.map(comunicacaoComoPublicacao), ref);
  },

  /**
   * Importa os processos localizados, descartando os baixados em definitivo e
   * os já cadastrados. Devolve o que entrou e o que foi deixado de fora, com
   * o motivo, para que a conferência seja possível.
   */
  importar(encontrados, { responsavelId = null } = {}) {
    const existentes = new Set(db.listar('processos').map((p) => cnjDigitos(p.numeroCNJ)));
    const importados = [];
    const arquivados = [];
    const duplicados = [];
    const invalidos = [];

    for (const bruto of encontrados) {
      const numero = cnjDigitos(bruto.numeroCNJ);
      if (numero.length !== 20) { invalidos.push(bruto); continue; }
      if (existentes.has(numero)) { duplicados.push(bruto); continue; }
      if (arquivadoEmDefinitivo(bruto)) { arquivados.push(bruto); continue; }

      existentes.add(numero);
      importados.push(db.inserir('processos', {
        numeroCNJ: numero,
        clienteId: null,
        tribunal: bruto.tribunal || '',
        comarca: bruto.comarca || '',
        uf: bruto.uf || '',
        vara: bruto.vara || '',
        classe: bruto.classe || '',
        assunto: bruto.assunto || '',
        poloAtivo: bruto.poloAtivo || '',
        poloPassivo: bruto.poloPassivo || '',
        responsavelId,
        status: 'ativo',
        fase: bruto.fase || '',
        regimePrazo: 'uteis',
        origem: 'consulta processual',
        // O vínculo com o cliente depende de conferência humana: a consulta
        // devolve as partes, não diz qual delas o escritório representa.
        pendenteVinculoCliente: true,
      }, 'Processo importado da consulta processual'));
    }

    return { importados, arquivados, duplicados, invalidos };
  },
};

/**
 * Lê uma lista de processos colada ou exportada do tribunal.
 *
 * Aceita uma coluna com o número do processo ou linhas separadas por ponto e
 * vírgula, tabulação ou barra vertical, na ordem número, classe, assunto,
 * vara, tribunal e situação. Linhas sem número CNJ válido são ignoradas.
 */
export function interpretarListaProcessos(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const saida = [];
  for (const linha of linhas) {
    const numeros = extrairNumerosCNJ(linha);
    if (!numeros.length) continue;
    const colunas = linha.split(/\s*[;|\t]\s*/);
    const [, classe = '', assunto = '', vara = '', tribunal = '', situacao = ''] =
      colunas.length > 1 ? colunas : [linha];
    saida.push({ numeroCNJ: numeros[0], classe, assunto, vara, tribunal, situacao });
  }
  return saida;
}

function hashPublicacao(p) {
  const base = `${p.numeroCNJ || ''}|${p.dataPublicacao || ''}|${String(p.conteudo || '').slice(0, 200)}`;
  let h = 5381;
  for (let i = 0; i < base.length; i += 1) h = ((h << 5) + h + base.charCodeAt(i)) >>> 0;
  return String(h);
}

/** Divide um texto colado do diário em publicações individuais. */
export function fatiarTextoDiario(texto, dataPublicacao) {
  const blocos = String(texto).split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 40);
  return blocos.map((conteudo) => ({ conteudo, dataPublicacao, diario: 'Colagem manual' }));
}

/* ------------------------------------------------------------ automações -- */

export const MODELOS_MENSAGEM = {
  prazoProximo: (ctx) => `Olá, ${ctx.primeiroNome}. Informamos que existe uma providência `
    + `relacionada ao seu processo nº ${ctx.numero} a ser realizada nos próximos dias. `
    + 'Nossa equipe já está cuidando do necessário.',
  audiencia: (ctx) => `Olá, ${ctx.primeiroNome}. Lembramos que a audiência referente ao processo `
    + `nº ${ctx.numero} ocorrerá em ${ctx.data}${ctx.hora ? ` às ${ctx.hora}` : ''}`
    + `${ctx.modalidade ? ` (${ctx.modalidade.toLowerCase()})` : ''}.`,
  relatorioMensal: (ctx) => `Olá, ${ctx.primeiroNome}. Seu relatório processual atualizado está disponível. `
    + 'Em caso de dúvida, estamos à disposição.',
  atualizacao: (ctx) => `Olá, ${ctx.primeiroNome}. Houve nova movimentação no processo nº ${ctx.numero}. `
    + 'Acesse o relatório atualizado para consultar a situação.',
  documentos: (ctx) => `Olá, ${ctx.primeiroNome}. Para dar andamento ao processo nº ${ctx.numero}, `
    + 'precisamos que nos envie os documentos solicitados.',
};

export function contextoMensagem({ clienteId, processoId, audiencia }) {
  const cliente = clienteDe(clienteId);
  const processo = processoId ? processoDe(processoId) : null;
  return {
    primeiroNome: String(cliente?.nome || 'cliente').split(' ')[0],
    nome: cliente?.nome || '', numero: processo ? fmtCNJ(processo.numeroCNJ) : '',
    data: audiencia ? fmtData(audiencia.data) : '', hora: audiencia?.hora || '',
    modalidade: audiencia?.modalidade || '',
  };
}

/**
 * Apura quais automações deveriam disparar hoje. O disparo efetivo depende de
 * confirmação ou de provedor configurado — o sistema não envia sozinho sem
 * que o administrador habilite a automação.
 */
export function automacoesPendentes(ref = hoje()) {
  const cfg = db.config().automacoesWhatsapp || {};
  const fila = [];

  if (cfg.prazoProximo?.ativo) {
    const alvo = addDays(ref, cfg.prazoProximo.antecedencia ?? 3);
    for (const p of db.listar('prazos')) {
      if (!['pendente', 'andamento'].includes(p.status) || p.dataVencimento !== alvo) continue;
      const proc = processoDe(p.processoId);
      if (!proc) continue;
      fila.push({ tipo: 'prazoProximo', clienteId: proc.clienteId, processoId: proc.id,
        mensagem: MODELOS_MENSAGEM.prazoProximo(contextoMensagem({ clienteId: proc.clienteId, processoId: proc.id })) });
    }
  }
  if (cfg.audiencia?.ativo) {
    const alvo = addDays(ref, cfg.audiencia.antecedencia ?? 2);
    for (const a of db.listar('audiencias')) {
      if (a.data !== alvo || a.status === 'cancelada') continue;
      const proc = processoDe(a.processoId);
      fila.push({ tipo: 'audiencia', clienteId: a.clienteId || proc?.clienteId, processoId: a.processoId,
        mensagem: MODELOS_MENSAGEM.audiencia(contextoMensagem({ clienteId: a.clienteId || proc?.clienteId, processoId: a.processoId, audiencia: a })) });
    }
  }
  if (cfg.relatorioMensal?.ativo && Number(ref.slice(8, 10)) === (cfg.relatorioMensal.dia || 1)) {
    for (const c of db.listar('clientes')) {
      if (!db.listar('processos', { clienteId: c.id }).some((p) => p.status === 'ativo')) continue;
      fila.push({ tipo: 'relatorioMensal', clienteId: c.id, processoId: null,
        mensagem: MODELOS_MENSAGEM.relatorioMensal(contextoMensagem({ clienteId: c.id })) });
    }
  }
  return fila;
}
