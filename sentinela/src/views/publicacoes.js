// Publicações — fila de conferência.
//
// Fluxo: publicação → identificação do processo pelo número CNJ → leitura
// assistida → sugestão de prazo → conferência do advogado → confirmação →
// prazo na agenda. Nada entra na agenda sem confirmação humana.

import { h, qs, esc, delegar, aviso, confirmar, modal } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, opcoesProcessos, opcoesUsuarios } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { interpretarPublicacao } from '../core/ia.js';
import { publicacoes as servicoPublicacoes, fatiarTextoDiario, oabsMonitoradas } from '../core/integracoes.js';
import {
  processoDe, nomeCliente, conflitosDePrazo, revisarVinculos,
  arquivarPublicacoes, reabrirPublicacoes, marcarPublicacoesSemPrazo,
} from '../core/dominio.js';
import { TIPOS_PRAZO, tipoPrazo } from '../core/calculo-prazo.js';
import { fmtCNJ, fmtData, hoje, cnjDigitos } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { abrirFormularioProcesso } from './processos.js';
import { usuarioAtual } from '../core/auth.js';

/** "diária" quando a rotina cobre a semana inteira; os dias, quando não cobre. */
const rotuloRotina = (dias) => (!dias?.length || dias.length >= 7 ? 'diária' : dias.join(' · '));

export function publicacoes({ params }) {
  if (params[0]) return fichaPublicacao(params[0]);
  definirTitulo('Publicações');
  let aba = 'pendente';
  // A seleção vale para a aba corrente: trocar de aba começa do zero.
  let selecionadas = new Set();

  const cfg = db.config().integracoes.publicacoes;
  // O período escolhido fica guardado: a tela é redesenhada a cada consulta e a
  // escolha não pode voltar sozinha ao padrão.
  // Zero significa retomar de onde a última consulta parou, que é o padrão:
  // período fixo repete o que já foi lido a cada busca.
  const diasConsulta = Number(cfg.diasConsulta) || 0;
  const inscricoes = oabsMonitoradas();
  const fonte = cfg.ativo && cfg.provedor
    ? `Provedor contratado: ${cfg.provedor}`
    : inscricoes.length
      ? `Consulta pública do CNJ (DJEN) pela OAB ${inscricoes.map((i) => `${i.numero}/${i.uf}`).join(', ')}`
      : 'Consulta pública do CNJ (DJEN) — nenhuma inscrição na OAB cadastrada';

  const tela = h(`<div>
    ${cabecalhoPagina('Publicações', `
      <select class="btn" data-periodo title="Período da consulta">
        <option value="0" ${diasConsulta ? '' : 'selected'}>desde a última consulta</option>
        ${[7, 15, 30, 60, 90].map((d) => `<option value="${d}"
          ${d === diasConsulta ? 'selected' : ''}>últimos ${d} dias</option>`).join('')}
      </select>
      <button class="btn btn--primario" data-acao="consultar">Consultar DJEN agora</button>
      <button class="btn" data-acao="revisar">Revisar vínculos</button>
      <button class="btn" data-acao="importar">Importar manualmente</button>`,
    `${fonte} · rotina ${rotuloRotina(cfg.dias)} · última consulta `
    + `${cfg.ultimaConsulta ? fmtData(cfg.ultimaConsulta) : 'nunca'}`)}
    <div class="abas">
      <div class="aba ativa" data-aba="pendente">Aguardando conferência</div>
      <div class="aba" data-aba="confirmada">Confirmadas</div>
      <div class="aba" data-aba="ignorada">Sem prazo</div>
      <div class="aba" data-aba="arquivada">Arquivadas</div>
    </div>
    <div id="barra-selecao"></div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    const lista = db.listar('publicacoes', { status: aba })
      .sort((a, b) => String(b.dataPublicacao).localeCompare(String(a.dataPublicacao)));

    // Seleção só faz sentido sobre o que está à vista.
    const visiveis = new Set(lista.map((x) => x.id));
    selecionadas = new Set([...selecionadas].filter((id) => visiveis.has(id)));
    desenharBarra(lista);

    qs('#lista', tela).innerHTML = lista.length ? `<ul class="lista">${lista.map((p) => {
      const s = p.sugestao || {};
      const proc = processoDe(p.processoId || s.processoId);
      return `<li class="lista__item" data-id="${p.id}">
        <span class="lista__faixa" style="background:var(--c-publicacao)"></span>
        <label class="selecao" title="Selecionar">
          <input type="checkbox" data-sel="${p.id}" ${selecionadas.has(p.id) ? 'checked' : ''}>
        </label>
        <div class="lista__corpo">
          <div class="lista__titulo">
            <span class="mono">${esc(fmtCNJ(p.numeroCNJ))}</span>
            ${proc ? `<span class="selo selo--ok">processo localizado</span>`
    : '<span class="selo selo--fatal">processo não cadastrado</span>'}
          </div>
          <div class="lista__meta quebra">${esc(String(p.conteudo).slice(0, 220))}…</div>
          <div class="lista__meta">
            ${proc ? `<span>${esc(nomeCliente(proc.clienteId))}</span>` : ''}
            <span>${esc(p.diario || '')}</span>
            ${s.dias ? `<span class="selo selo--proximo">prazo sugerido: ${s.dias} dias — vence ${esc(fmtData(s.vencimentoSugerido))}</span>` : ''}
          </div>
        </div>
        <div class="lista__lado">${esc(fmtData(p.dataPublicacao))}</div>
      </li>`;
    }).join('')}</ul>` : '<div class="vazio"><span class="ico">📰</span>Nada nesta aba.</div>';
  };

  /** Barra de ações em lote, presente só quando há o que selecionar. */
  const desenharBarra = (lista) => {
    const caixa = qs('#barra-selecao', tela);
    if (!lista.length) { caixa.innerHTML = ''; return; }
    const n = selecionadas.size;
    const todas = n === lista.length;
    caixa.innerHTML = `<div class="barra-lote">
      <label class="linha">
        <input type="checkbox" data-sel-todos ${todas ? 'checked' : ''}
          ${n && !todas ? 'data-parcial' : ''}>
        <span class="mini">${n ? `${n} de ${lista.length} selecionada(s)` : 'Selecionar todas'}</span>
      </label>
      ${n ? `<span class="linha">
        ${aba !== 'arquivada'
    ? '<button class="btn btn--pequeno" data-lote="arquivar">Arquivar</button>' : ''}
        ${aba === 'arquivada'
    ? '<button class="btn btn--pequeno" data-lote="reabrir">Devolver à fila</button>' : ''}
        ${aba === 'pendente'
    ? '<button class="btn btn--pequeno" data-lote="sem-prazo">Marcar sem prazo</button>' : ''}
        <button class="btn btn--pequeno btn--fantasma" data-lote="limpar">Limpar seleção</button>
      </span>` : ''}
    </div>`;
    const marcador = qs('[data-sel-todos]', caixa);
    if (marcador) marcador.indeterminate = Boolean(n) && !todas;
  };

  delegar(tela, 'change', '[data-sel]', (_e, el) => {
    if (el.checked) selecionadas.add(el.dataset.sel);
    else selecionadas.delete(el.dataset.sel);
    desenharBarra(db.listar('publicacoes', { status: aba }));
  });

  delegar(tela, 'change', '[data-sel-todos]', (_e, el) => {
    const lista = db.listar('publicacoes', { status: aba });
    selecionadas = el.checked ? new Set(lista.map((x) => x.id)) : new Set();
    desenhar();
  });

  delegar(tela, 'click', '[data-lote]', async (_e, el) => {
    const acao = el.dataset.lote;
    if (acao === 'limpar') { selecionadas = new Set(); desenhar(); return; }

    const ids = [...selecionadas];
    const rotulos = {
      arquivar: ['Arquivar publicações',
        `Arquivar ${ids.length} publicação(ões)? Elas saem da fila de conferência e continuam `
        + 'consultáveis na aba Arquivadas, de onde podem voltar.'],
      reabrir: ['Devolver à fila',
        `Devolver ${ids.length} publicação(ões) à fila de conferência?`],
      'sem-prazo': ['Marcar sem prazo',
        `Marcar ${ids.length} publicação(ões) como sem prazo a cumprir? `
        + 'Use apenas quando o ato realmente não abre prazo.'],
    }[acao];

    if (!await confirmar({ titulo: rotulos[0], mensagem: rotulos[1], rotuloOk: rotulos[0] })) return;

    const r = acao === 'arquivar' ? arquivarPublicacoes(ids)
      : acao === 'reabrir' ? reabrirPublicacoes(ids)
        : marcarPublicacoesSemPrazo(ids);
    selecionadas = new Set();
    aviso(`${r.alteradas} publicação(ões) atualizada(s).`, 'ok');
    desenhar();
  });

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    selecionadas = new Set();
    aba = el.dataset.aba;
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    desenhar();
  });
  delegar(tela, 'click', '.lista__item[data-id]', (ev, el) => {
    if (ev.target.closest('.selecao')) return;
    ir(`publicacoes/${el.dataset.id}`);
  });
  delegar(tela, 'click', '[data-acao="revisar"]', () => {
    const r = revisarVinculos({ reinterpretar: interpretarPublicacao });
    const partes = [];
    if (r.vinculadas) partes.push(`${r.vinculadas} publicação(ões) vinculada(s) ao processo`);
    if (r.desvinculadas) partes.push(`${r.desvinculadas} sem processo existente`);
    if (r.clientesHerdados) partes.push(`${r.clientesHerdados} registro(s) com cliente preenchido`);
    aviso(partes.length ? `${partes.join('; ')}.` : 'Os vínculos já estavam em dia.',
      r.total ? 'ok' : 'atencao');
    recarregar();
  });
  delegar(tela, 'change', '[data-periodo]', (_e, el) => {
    const conf = db.config().integracoes;
    db.salvarConfig({ integracoes: { ...conf,
      publicacoes: { ...conf.publicacoes, diasConsulta: Number(el.value) || 0 } } });
  });
  delegar(tela, 'click', '[data-acao="importar"]', () => abrirImportacao(desenhar));
  delegar(tela, 'click', '[data-acao="consultar"]', async (_e, el) => {
    if (!inscricoes.length && !(cfg.ativo && cfg.provedor)) { abrirCadastroOAB(); return; }
    el.disabled = true;
    const rotulo = el.textContent;
    el.textContent = 'Consultando…';
    try {
      // A consulta manual vale pelo período escolhido, contado de hoje para trás.
      // Prendê-la à última consulta encolhia a janela para um único dia e, depois
      // da primeira busca do dia, nada mais voltava.
      const dias = Number(qs('[data-periodo]', tela)?.value) || diasConsulta;
      // Sem período fixo, o serviço retoma da última consulta com o piso de uma
      // semana — é o que evita reler o mesmo mês a cada busca.
      const r = await servicoPublicacoes.consultar(dias ? { dias } : {});
      aviso(r.mensagem, r.erro ? 'erro' : r.recebidas ? 'ok' : 'atencao');
      recarregar();
    } finally {
      el.disabled = false;
      el.textContent = rotulo;
    }
  });
  desenhar();
  return tela;
}

/* ----------------------------------------------------------------- ficha */

function fichaPublicacao(id) {
  const p = db.obter('publicacoes', id);
  if (!p) return '<div class="aviso aviso--alerta">Publicação não encontrada.</div>';
  const s = p.sugestao || interpretarPublicacao(p);
  const processoId = p.processoId || s.processoId || null;
  const proc = processoId ? processoDe(processoId) : null;
  definirTitulo('Publicação');

  const tela = h(`<div>
    ${cabecalhoPagina('Publicação', p.status === 'pendente' ? `
      <button class="btn btn--primario" data-acao="confirmar">Confirmar prazo</button>
      <button class="btn" data-acao="ignorar">Não é prazo</button>` : '',
    `${p.diario || ''} · publicada em ${fmtData(p.dataPublicacao)}`, { voltar: 'publicacoes' })}

    ${p.status === 'pendente' ? `<div class="aviso aviso--atencao">
      ⚠️ PRAZO IDENTIFICADO AUTOMATICAMENTE — NECESSITA DE CONFIRMAÇÃO.
      A leitura automática é sugestão de apoio. O prazo só entra na agenda após conferência do advogado.
    </div>` : `<div class="aviso aviso--ok">Publicação ${esc(p.status)}.</div>`}

    <div class="grade grade--2">
      <section class="cartao"><div class="cartao__corpo">
        <h3>Conteúdo</h3>
        <div class="quebra" style="margin-top:.5rem;font-size:.88rem">${esc(p.conteudo)}</div>
      </div></section>

      <section class="cartao"><div class="cartao__corpo">
        <h3>Leitura assistida</h3>
        <dl class="chave-valor" style="margin-top:.5rem">
          <dt>Processo</dt><dd>${proc ? `<a href="#/processos/${proc.id}" class="mono">${esc(fmtCNJ(proc.numeroCNJ))}</a>`
    : `<span class="selo selo--fatal">não localizado</span>`}</dd>
          <dt>Cliente</dt><dd>${proc ? esc(nomeCliente(proc.clienteId)) : '—'}</dd>
          <dt>Tipo sugerido</dt><dd>${esc(s.tipoRotulo || '—')}</dd>
          <dt>Prazo</dt><dd>${s.dias ? `${s.dias} ${s.contagem === 'uteis' ? 'dias úteis' : 'dias corridos'}` : 'não identificado'}</dd>
          <dt>Publicação</dt><dd>${esc(fmtData(s.dataPublicacao || p.dataPublicacao))}</dd>
          <dt>Início sugerido</dt><dd>${esc(fmtData(s.inicioSugerido))}</dd>
          <dt>Vencimento sugerido</dt><dd class="negrito">${esc(fmtData(s.vencimentoSugerido))}</dd>
          <dt>Confiança</dt><dd>
            <div class="barra-progresso" style="width:120px"><div style="width:${s.confianca || 0}%"></div></div>
            <span class="mini mudo">${s.confianca || 0}%</span></dd>
        </dl>
        ${(s.alertas || []).map((a) => `<div class="aviso aviso--atencao" style="margin-top:.4rem">${esc(a)}</div>`).join('')}
        ${s.calculo ? `<details style="margin-top:.5rem"><summary class="mini">Memória de cálculo</summary>
          ${s.calculo.passos.map((x) => `<div class="mini mudo">• ${esc(x)}</div>`).join('')}</details>` : ''}
        ${!proc ? `<div class="linha" style="margin-top:.6rem">
          <button class="btn" data-acao="cadastrar-processo">Cadastrar processo com este número</button>
          <button class="btn" data-acao="revincular">Procurar processo cadastrado</button>
        </div>` : ''}
      </div></section>
    </div>
  </div>`);

  delegar(tela, 'click', '[data-acao="cadastrar-processo"]', () =>
    abrirFormularioProcesso({ numeroCNJ: p.numeroCNJ }, () => {
      const novo = db.listar('processos').find((x) => cnjDigitos(x.numeroCNJ) === cnjDigitos(p.numeroCNJ));
      if (novo) db.atualizar('publicacoes', id, { processoId: novo.id }, 'Publicação vinculada ao processo');
      recarregar();
    }));

  delegar(tela, 'click', '[data-acao="revincular"]', () => {
    const r = revisarVinculos({ numeroCNJ: p.numeroCNJ, reinterpretar: interpretarPublicacao });
    aviso(r.vinculadas
      ? 'Publicação vinculada ao processo cadastrado.'
      : 'Nenhum processo com este número foi encontrado na base.', r.vinculadas ? 'ok' : 'atencao');
    if (r.vinculadas) recarregar();
  });
  delegar(tela, 'click', '[data-acao="ignorar"]', async () => {
    if (!await confirmar({ titulo: 'Marcar como sem prazo',
      mensagem: 'A publicação sai da fila de conferência e nenhum prazo será criado. Confirma?' })) return;
    db.atualizar('publicacoes', id, { status: 'ignorada' }, 'Publicação marcada como sem prazo');
    aviso('Publicação arquivada sem prazo.', 'ok');
    ir('publicacoes');
  });

  delegar(tela, 'click', '[data-acao="confirmar"]', () => abrirConfirmacao(p, s));
  return tela;
}

/** Conferência final: o advogado revisa e confirma o prazo sugerido. */
function abrirConfirmacao(pub, s) {
  const campos = [
    { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos(),
      obrigatorio: true, largura: 2 },
    { nome: 'tipo', rotulo: 'Tipo de prazo', tipo: 'select', vazio: false,
      opcoes: TIPOS_PRAZO.map((t) => ({ valor: t.id, rotulo: t.rotulo })) },
    { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', largura: 2 },
    { nome: 'dataInicio', rotulo: 'Início', tipo: 'date' },
    { nome: 'dataVencimento', rotulo: 'Vencimento', tipo: 'date', obrigatorio: true },
    { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', vazio: false,
      opcoes: [{ valor: 'normal', rotulo: 'Normal' }, { valor: 'importante', rotulo: 'Importante' },
        { valor: 'urgente', rotulo: 'Urgente' }, { valor: 'fatal', rotulo: 'Fatal' }] },
    { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', opcoes: opcoesUsuarios(), obrigatorio: true },
    { nome: 'fatal', rotulo: 'Prazo fatal', tipo: 'checkbox', largura: 2 },
  ];
  let confirmado = false;

  modalFormulario({
    titulo: 'Conferência do prazo sugerido', campos, largo: true, rotuloSalvar: 'Confirmar e lançar na agenda',
    valores: {
      processoId: pub.processoId || s.processoId || '', tipo: s.tipo || 'outros',
      descricao: `${s.tipoRotulo || 'Providência'} — publicação de ${fmtData(pub.dataPublicacao)}`,
      dataInicio: s.inicioSugerido || '', dataVencimento: s.vencimentoSugerido || '',
      prioridade: 'importante',
      responsavelId: processoDe(pub.processoId || s.processoId)?.responsavelId || '',
    },
    extras: `<div class="aviso aviso--info" style="margin-top:.7rem">
      Regra aplicada na sugestão: ${esc(s.calculo?.resumoRegra || 'não calculada')}.
      Revise as datas antes de confirmar.</div>`,
    aoSalvar: (dados, ctx) => {
      const processo = processoDe(dados.processoId);
      const registro = {
        ...dados, clienteId: processo?.clienteId || null,
        origemPublicacaoId: pub.id,
        alertas: db.config().alertasPadrao,
        regraCalculo: s.calculo ? {
          resumoRegra: s.calculo.resumoRegra, fundamento: s.calculo.fundamento,
          passos: s.calculo.passos, desprezados: s.calculo.desprezados,
          origem: 'sugestão automática confirmada pelo advogado',
        } : null,
        status: 'pendente',
      };
      const conflitos = conflitosDePrazo(registro).filter((c) => c.nivel !== 'info');
      if (conflitos.length && !confirmado) {
        confirmado = true;
        ctx.avisos.innerHTML = conflitos.map((c) => `<div class="aviso aviso--${c.nivel}">⚠️ ${esc(c.texto)}</div>`).join('')
          + '<div class="aviso aviso--info">Clique novamente para confirmar mesmo assim.</div>';
        return false;
      }
      const prazo = db.inserir('prazos', registro, 'Prazo confirmado a partir de publicação');
      db.atualizar('publicacoes', pub.id, { status: 'confirmada', prazoId: prazo.id },
        'Publicação conferida e prazo confirmado');
      aviso('Prazo confirmado e lançado na agenda.', 'ok');
      ir(`prazos/${prazo.id}`);
    },
  });
}

/* ---------------------------------------------------------- importação -- */

function abrirImportacao(aoConcluir) {
  modalFormulario({
    titulo: 'Importar publicações', largo: true,
    campos: [
      { nome: 'dataPublicacao', rotulo: 'Data da publicação', tipo: 'date', obrigatorio: true },
      { nome: 'diario', rotulo: 'Diário / fonte', tipo: 'text', largura: 2 },
      { nome: 'texto', rotulo: 'Texto das publicações', tipo: 'textarea', obrigatorio: true, largura: 3,
        ajuda: 'Cole o recorte do diário. Publicações separadas por linha em branco são tratadas individualmente.' },
    ],
    valores: { dataPublicacao: hoje() },
    rotuloSalvar: 'Importar e analisar',
    aoSalvar: ({ texto, dataPublicacao, diario }) => {
      const brutas = fatiarTextoDiario(texto, dataPublicacao).map((b) => ({ ...b, diario: diario || b.diario }));
      if (!brutas.length) { aviso('Nenhum bloco de texto identificado.', 'erro'); return false; }
      const r = servicoPublicacoes.importar(brutas, dataPublicacao);
      aviso(r.mensagem, 'ok');
      aoConcluir?.();
    },
  });
}

/* -------------------------------------------------- inscrição na OAB ----- */

/**
 * Sem inscrição cadastrada não há o que consultar no DJEN. Em vez de recusar,
 * a tela pede o dado que falta e grava no usuário da sessão.
 */
function abrirCadastroOAB() {
  const usuario = usuarioAtual();
  modalFormulario({
    titulo: 'Informe sua inscrição na OAB',
    campos: [
      { nome: 'numero', rotulo: 'Número', tipo: 'text', obrigatorio: true },
      { nome: 'uf', rotulo: 'Seccional', tipo: 'text', obrigatorio: true, largura: 2,
        ajuda: 'Sigla do estado, como PE ou SP.' },
    ],
    rotuloSalvar: 'Salvar e consultar',
    aoSalvar: async ({ numero, uf }) => {
      const inscricao = `OAB/${String(uf).toUpperCase()} ${String(numero).replace(/\D/g, '')}`;
      db.atualizar('usuarios', usuario.id, { oab: inscricao }, 'Inscrição na OAB registrada');
      const r = await servicoPublicacoes.consultar({ dias: 30 });
      aviso(r.mensagem, r.importadas ? 'ok' : r.erro ? 'erro' : 'atencao');
      recarregar();
    },
  });
}
