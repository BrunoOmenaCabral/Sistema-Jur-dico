// Integrações externas em formato de adaptadores.
//
// Cada integração expõe a mesma assinatura e pode ser trocada por uma
// implementação oficial (API do WhatsApp Business, servidor SMTP, provedor de
// publicações, Google Calendar) sem tocar no restante do sistema. Enquanto o
// provedor não estiver configurado, o adaptador local resolve o essencial:
// abre o WhatsApp Web, o cliente de e-mail ou gera o arquivo para download.

import { db, DIAS_ROTINA } from './store.js';
import { fmtCNJ, fmtData, iso, hoje, addDays, diffDias, uid, norm, cnjDigitos } from './util.js';
import { processoDe, clienteDe, nomeCliente } from './dominio.js';
import { interpretarPublicacao, extrairNumerosCNJ } from './ia.js';
import { consultarPorOAB as consultarDJEN, consultarPorProcesso as consultarDJENProcesso,
  agruparEmProcessos, comunicacaoComoPublicacao, parsearOAB } from './djen.js';
import { consultarProcesso as consultarDataJud, ehAtoDecisorio } from './datajud.js';

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

// Dias de sobreposição na consulta automática, para cobrir a comunicação que o
// diário publica com disponibilização retroativa e o dia em que a consulta falhou.
const RETROACAO = 3;

/**
 * Inscrições na OAB acompanhadas pelo escritório.
 *
 * Valem as listadas em Configurações. Na falta delas, as dos próprios usuários
 * ativos, que é o caso comum do advogado que acabou de criar a conta.
 */
export function oabsMonitoradas() {
  const cfg = db.config().integracoes.publicacoes || {};
  const daConfiguracao = String(cfg.oabs || '').split(/[,;\n]/).map(parsearOAB).filter(Boolean);
  const lista = daConfiguracao.length
    ? daConfiguracao
    : db.listar('usuarios').filter((u) => u.ativo !== false).map((u) => parsearOAB(u.oab)).filter(Boolean);

  const vistas = new Set();
  return lista.filter(({ numero, uf }) => {
    const chave = `${numero}/${uf}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

export const publicacoes = {
  /**
   * A consulta ao diário é devida todo dia, uma vez por dia. O escritório pode
   * restringir os dias em Configurações, mas o padrão não deixa a intimação
   * esperar: prazo corre em dia útil, e a publicação de terça conta de quarta.
   */
  devidaHoje(ref = hoje()) {
    const cfg = db.config().integracoes.publicacoes;
    const dia = DIAS_SEMANA_ID[new Date(`${ref}T12:00:00`).getDay()];
    return (cfg?.dias?.length ? cfg.dias : DIAS_ROTINA).includes(dia)
      && cfg?.ultimaConsulta !== ref;
  },

  /**
   * Busca as intimações do escritório.
   *
   * A fonte padrão é a consulta pública do CNJ, pela inscrição na OAB de cada
   * advogado: é aberta, não exige certificado e cobre os tribunais integrados
   * ao Diário de Justiça Eletrônico Nacional. Havendo provedor contratado, ele
   * tem precedência, porque alcança também o que o DJEN não publica.
   *
   * @returns {Promise<{importadas:number, ignoradas:number, mensagem:string}>}
   */
  async consultar({ ref = hoje(), lote = null, de = null, ate = null, dias = null } = {}) {
    const cfg = db.config().integracoes.publicacoes || {};
    if (lote) return this.importar(lote, ref);

    if (cfg.ativo && cfg.provedor) {
      // Ponto de extensão: requisição ao provedor de monitoramento contratado.
      return this.importar([], ref);
    }

    const inscricoes = oabsMonitoradas();
    if (!inscricoes.length) {
      return { importadas: 0, ignoradas: 0, semOAB: true,
        mensagem: 'Nenhuma inscrição na OAB cadastrada. Informe a sua em Usuários, ou liste as '
          + 'inscrições do escritório em Configurações, para que a consulta ao DJEN seja possível.' };
    }

    // Retoma de onde parou, mas sempre com alguns dias de sobreposição: o DJEN
    // publica comunicação cuja disponibilização é anterior ao dia da consulta e,
    // se um dia falhar, a sobreposição impede que o período vire buraco.
    const inicio = de
      || (dias ? addDays(ref, -Math.abs(dias)) : null)
      || (cfg.ultimaConsulta ? addDays(cfg.ultimaConsulta, -RETROACAO) : addDays(ref, -7));
    const fim = ate || ref;
    const brutas = [];
    const falhas = [];

    for (const { numero, uf } of inscricoes) {
      const r = await consultarDJEN({ numeroOab: numero, ufOab: uf, de: inicio, ate: fim });
      if (!r.ok) { falhas.push(`OAB ${numero}/${uf}: ${r.motivo}`); continue; }
      brutas.push(...r.comunicacoes.map(comunicacaoComoPublicacao));
    }

    // Toda consulta falhou: é falha de comunicação, não ausência de intimação.
    if (falhas.length === inscricoes.length) {
      return { importadas: 0, ignoradas: 0, erro: true, falhas, mensagem: falhas[0] };
    }

    const r = this.importar(brutas, ref);
    const rotulo = inscricoes.map((i) => `${i.numero}/${i.uf}`).join(', ');
    const periodo = `${fmtData(inicio)} a ${fmtData(fim)}`;
    const pendura = falhas.length ? ` ${falhas.length} inscrição(ões) sem resposta.` : '';

    // A marca do dia só avança quando todas as inscrições responderam. Avançar
    // após falha deixaria o período sem nova tentativa — e intimação perdida.
    if (!falhas.length) this.marcarConsulta(ref);

    return { ...r, falhas, recebidas: brutas.length, inicio, fim,
      mensagem: brutas.length
        ? `${brutas.length} comunicação(ões) de ${periodo} para ${rotulo}: `
          + `${r.importadas} nova(s), ${r.ignoradas} já existente(s).${pendura}`
        : `O DJEN respondeu sem comunicações de ${periodo} para ${rotulo}.${pendura}` };
  },

  /** Registra o dia da última consulta bem-sucedida ao diário. */
  marcarConsulta(ref = hoje()) {
    const cfg = db.config().integracoes;
    db.salvarConfig({ integracoes: { ...cfg,
      publicacoes: { ...cfg.publicacoes, ultimaConsulta: ref } } });
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

// Janela entre o ato e a publicação da intimação correspondente. O diário sai
// depois do ato, nunca antes, e o intervalo raramente passa de duas semanas.
const DIAS_ATE_PUBLICACAO = 20;

/**
 * Acopla a cada ato decisório o texto da intimação que o publicou.
 *
 * O DataJud informa que houve sentença, mas não o que ela diz: a base guarda
 * metadados do movimento, não o documento. O teor está na comunicação
 * publicada no diário, e é de lá que vem.
 *
 * O casamento é por proximidade de data, com a publicação sempre posterior ao
 * ato. Quando há mais de uma candidata, prevalece a mais próxima.
 */
export function acoplarTeor(movimentos, comunicacoes) {
  const candidatas = comunicacoes
    .map((c) => ({
      data: normalizarDataDJEN(c.data_disponibilizacao || c.datadisponibilizacao),
      texto: String(c.texto || '').trim(),
      link: c.link || '',
      tipo: c.tipoComunicacao || '',
    }))
    .filter((c) => c.data && c.texto);

  let acoplados = 0;
  const saida = movimentos.map((movimento) => {
    if (!ehAtoDecisorio(movimento)) return movimento;

    const escolhida = candidatas
      .filter((c) => c.data >= movimento.data && diffDias(movimento.data, c.data) <= DIAS_ATE_PUBLICACAO)
      .sort((a, b) => diffDias(movimento.data, a.data) - diffDias(movimento.data, b.data))[0];
    if (!escolhida) return movimento;

    acoplados += 1;
    return {
      ...movimento,
      teor: escolhida.texto,
      linkTeor: escolhida.link,
      fonteTeor: `Diário de Justiça Eletrônico Nacional, publicado em ${fmtData(escolhida.data)}`,
    };
  });

  return { movimentos: saida, acoplados, candidatas: candidatas.length };
}

const normalizarDataDJEN = (valor) => {
  if (!valor) return null;
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
};

/**
 * Traz para a linha do tempo os movimentos que o tribunal já registrou.
 *
 * A fonte é o DataJud, onde cada tribunal alimenta a capa e o andamento a
 * partir do próprio sistema. Serve ao processo cadastrado à mão, que entra no
 * sistema sem histórico algum, e à conferência do que foi perdido.
 *
 * Movimento já importado não entra de novo: a chave de origem identifica cada
 * um. O que foi lançado à mão pelo escritório permanece intocado.
 */
export async function atualizarPeloTribunal(processoId, { indice = null, sinal = null } = {}) {
  const processo = processoDe(processoId);
  if (!processo) return { ok: false, motivo: 'Processo não encontrado.', importados: 0 };

  const r = await consultarDataJud({
    numeroCNJ: processo.numeroCNJ, tribunal: processo.tribunal, indice, sinal,
  });
  if (!r.ok) return { ok: false, motivo: r.motivo, importados: 0 };

  // Havendo ato decisório, busca-se o texto que o publicou. Primeiro no que já
  // está na base, que nada custa, depois no diário.
  let movimentos = r.movimentos;
  let comTeor = 0;
  let motivoTeor = null;
  let consultadas = 0;
  const decisorios = movimentos.filter(ehAtoDecisorio).length;

  if (!decisorios && movimentos.length) {
    motivoTeor = 'Nenhum dos movimentos recebidos é ato decisório: são andamentos como juntada, '
      + 'conclusão e expedição de documento, que não têm teor a publicar.';
  }

  if (decisorios) {
    const locais = db.listar('publicacoes', { processoId }).map((pub) => ({
      data_disponibilizacao: pub.dataDisponibilizacao || pub.dataPublicacao,
      texto: pub.conteudo, link: pub.link || '',
    }));

    // A janela vai do primeiro ao último ato decisório, com folga para a
    // publicação que vem depois. Pedir do primeiro ato até hoje faria, em
    // processo antigo, uma janela de anos, que o serviço não atende bem.
    const datas = movimentos.filter(ehAtoDecisorio).map((m) => m.data).filter(Boolean).sort();
    const inicio = datas[0] ? addDays(datas[0], -1) : null;
    const fimBruto = datas.at(-1) ? addDays(datas.at(-1), DIAS_ATE_PUBLICACAO + 5) : hoje();
    const fim = fimBruto > hoje() ? hoje() : fimBruto;

    const diario = await consultarDJENProcesso({
      numeroProcesso: processo.numeroCNJ,
      de: inicio,
      ate: fim,
      sinal,
    });

    const candidatas = [...locais, ...(diario.ok ? diario.comunicacoes : [])];
    consultadas = candidatas.length;
    const r2 = acoplarTeor(movimentos, candidatas);
    movimentos = r2.movimentos;
    comTeor = r2.acoplados;

    // Sem teor algum, o sistema diz por quê em vez de deixar o resultado mudo.
    if (!comTeor) {
      if (!diario.ok) motivoTeor = `O diário não respondeu à consulta: ${diario.motivo}`;
      else if (!candidatas.length) {
        motivoTeor = 'O diário não tem publicação alguma deste processo. O Diário de Justiça '
          + 'Eletrônico Nacional cobre os atos a partir da sua entrada em operação, e processo '
          + 'em segredo de justiça não é publicado.';
      } else {
        motivoTeor = `Foram encontradas ${candidatas.length} publicação(ões) do processo, mas `
          + 'nenhuma cai no intervalo esperado entre o ato e a sua publicação. O teor pode ser '
          + 'colado à mão ao editar a movimentação.';
      }
    }
  }

  const existentes = new Map(db.listar('movimentacoes', { processoId })
    .filter((m) => m.chaveExterna).map((m) => [m.chaveExterna, m]));

  let importados = 0;
  let teoresAcrescentados = 0;
  for (const movimento of movimentos) {
    const jaGravado = existentes.get(movimento.chaveExterna);

    // Movimento já importado não entra de novo, mas pode ter ficado sem teor
    // numa consulta anterior em que o diário não respondeu. Complementa-se o
    // que falta, sem desfazer o que já estava lá.
    if (jaGravado) {
      if (movimento.teor && !jaGravado.teor) {
        db.atualizar('movimentacoes', jaGravado.id, {
          teor: movimento.teor,
          linkTeor: movimento.linkTeor || null,
          fonteTeor: movimento.fonteTeor || null,
        }, 'Teor do ato recuperado do diário oficial');
        teoresAcrescentados += 1;
      }
      continue;
    }

    existentes.set(movimento.chaveExterna, movimento);
    db.inserir('movimentacoes', { ...movimento, processoId }, 'Movimento importado do tribunal');
    importados += 1;
  }

  // Campos da capa que o cadastro manual costuma deixar em branco. A data da
  // conferência entra sempre: é o que permite ao relatório dizer até quando o
  // andamento foi verificado na origem.
  const completar = { ultimaConsultaTribunal: hoje() };
  for (const campo of ['tribunal', 'classe', 'assunto', 'vara', 'dataDistribuicao']) {
    if (!processo[campo] && r.processo[campo]) completar[campo] = r.processo[campo];
  }
  db.atualizar('processos', processoId, completar, 'Andamento conferido junto ao tribunal');

  return {
    ok: true,
    motivo: null,
    indice: r.indice,
    // As instâncias consultadas e a data em que cada tribunal alimentou a base:
    // é o que explica por que um movimento recente pode ainda não constar.
    graus: r.graus || [],
    importados,
    total: movimentos.length,
    repetidos: movimentos.length - importados,
    decisorios,
    comTeor,
    teoresAcrescentados,
    motivoTeor,
    publicacoesConsultadas: consultadas,
    capa: r.processo,
    complementados: Object.keys(completar).filter((c) => c !== 'ultimaConsultaTribunal'),
  };
}

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
