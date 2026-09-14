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
import { publicacoes as servicoPublicacoes, fatiarTextoDiario } from '../core/integracoes.js';
import { processoDe, nomeCliente, conflitosDePrazo } from '../core/dominio.js';
import { TIPOS_PRAZO, tipoPrazo } from '../core/calculo-prazo.js';
import { fmtCNJ, fmtData, hoje, cnjDigitos } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { abrirFormularioProcesso } from './processos.js';

export function publicacoes({ params }) {
  if (params[0]) return fichaPublicacao(params[0]);
  definirTitulo('Publicações');
  let aba = 'pendente';

  const cfg = db.config().integracoes.publicacoes;
  const tela = h(`<div>
    ${cabecalhoPagina('Publicações', `
      <button class="btn btn--primario" data-acao="importar">Importar publicações</button>
      <button class="btn" data-acao="consultar">Consultar agora</button>`,
    `Rotina de consulta: ${(cfg.dias || []).join(' · ')} · última consulta ${cfg.ultimaConsulta ? fmtData(cfg.ultimaConsulta) : 'nunca'}`)}
    <div class="abas">
      <div class="aba ativa" data-aba="pendente">Aguardando conferência</div>
      <div class="aba" data-aba="confirmada">Confirmadas</div>
      <div class="aba" data-aba="ignorada">Sem prazo</div>
    </div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    const lista = db.listar('publicacoes', { status: aba })
      .sort((a, b) => String(b.dataPublicacao).localeCompare(String(a.dataPublicacao)));
    qs('#lista', tela).innerHTML = lista.length ? `<ul class="lista">${lista.map((p) => {
      const s = p.sugestao || {};
      const proc = processoDe(p.processoId || s.processoId);
      return `<li class="lista__item" data-id="${p.id}">
        <span class="lista__faixa" style="background:var(--c-publicacao)"></span>
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

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    aba = el.dataset.aba;
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    desenhar();
  });
  delegar(tela, 'click', '.lista__item[data-id]', (_e, el) => ir(`publicacoes/${el.dataset.id}`));
  delegar(tela, 'click', '[data-acao="importar"]', () => abrirImportacao(desenhar));
  delegar(tela, 'click', '[data-acao="consultar"]', async () => {
    const r = await servicoPublicacoes.consultar();
    aviso(r.mensagem, r.importadas ? 'ok' : 'atencao');
    desenhar();
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
    `${p.diario || ''} · publicada em ${fmtData(p.dataPublicacao)}`)}

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
        ${!proc ? '<button class="btn" style="margin-top:.6rem" data-acao="cadastrar-processo">Cadastrar processo com este número</button>' : ''}
      </div></section>
    </div>
  </div>`);

  delegar(tela, 'click', '[data-acao="cadastrar-processo"]', () =>
    abrirFormularioProcesso({ numeroCNJ: p.numeroCNJ }, () => {
      const novo = db.listar('processos').find((x) => cnjDigitos(x.numeroCNJ) === cnjDigitos(p.numeroCNJ));
      if (novo) db.atualizar('publicacoes', id, { processoId: novo.id }, 'Publicação vinculada ao processo');
      recarregar();
    }));

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
