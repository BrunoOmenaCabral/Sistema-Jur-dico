// Dashboard — a primeira tela responde, nesta ordem: o que tenho para fazer,
// quando, e em qual processo/cliente.

import { h, qs, esc, delegar, modal } from '../ui/ui.js';
import {
  cabecalhoPagina, cartaoIndicador, ligarIndicadores, calendarioMensal, listaEventos,
  detalhesDoDia,
} from '../ui/componentes.js';
import { indicadores, pautaDoDia, eventosAgenda, sincronizarNotificacoes } from '../core/dominio.js';
import { hoje, MESES, addDays, fmtData, fmtDataExtenso, fmtCNJ, iso, toDate, diasNoMes } from '../core/util.js';
import { ir } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { abrirFormularioPrazo } from './prazos.js';

let estadoCal = { ano: new Date().getFullYear(), mes: new Date().getMonth(), visual: 'mes' };

export function dashboard() {
  definirTitulo('Dashboard');
  sincronizarNotificacoes();
  const ind = indicadores();
  const pauta = pautaDoDia();

  const tela = h(`<div>
    ${cabecalhoPagina('Painel do escritório', `
      <button class="btn btn--primario" data-acao="pauta">O que preciso fazer hoje?</button>
      <button class="btn" data-acao="novo-prazo">Novo prazo</button>`,
    fmtDataExtenso(hoje()))}

    <div class="grade grade--indicadores" style="margin-bottom:1rem" id="indicadores">
      ${cartaoIndicador({ rotulo: 'Prazos vencidos', valor: ind.vencidos,
        nota: ind.vencidos ? 'exigem providência imediata' : 'nenhuma pendência vencida',
        variante: ind.vencidos ? 'fatal' : 'ok', rota: 'prazos?filtro=vencidos' })}
      ${cartaoIndicador({ rotulo: 'Hoje', valor: ind.prazosHoje + ind.tarefasHoje + ind.audienciasHoje,
        nota: `${ind.prazosHoje} prazos · ${ind.tarefasHoje} tarefas · ${ind.audienciasHoje} audiências`,
        variante: ind.prazosHoje ? 'proximo' : '', rota: 'agenda' })}
      ${cartaoIndicador({ rotulo: 'Próximos 7 dias', valor: ind.prazos7 + ind.tarefas7,
        nota: `${ind.prazos7} prazos · ${ind.tarefas7} tarefas · ${ind.audiencias7} audiências`,
        rota: 'agenda' })}
      ${cartaoIndicador({ rotulo: 'Publicações pendentes', valor: ind.publicacoesPendentes,
        nota: 'aguardando conferência', variante: ind.publicacoesPendentes ? 'publicacao' : '',
        rota: 'publicacoes' })}
      ${cartaoIndicador({ rotulo: 'Processos ativos', valor: ind.processosAtivos,
        nota: `${ind.processosTotal} cadastrados`, rota: 'processos' })}
      ${cartaoIndicador({ rotulo: 'Clientes', valor: ind.clientesAtivos, nota: 'ativos', rota: 'clientes' })}
    </div>

    <div class="grade grade--painel">
      <section class="cartao" id="cartao-calendario">
        <div class="cal__topo">
          <div class="linha">
            <span class="cal__mes" id="cal-mes"></span>
          </div>
          <div class="cal__nav">
            <button class="btn btn--pequeno" data-nav="ano-1" title="Ano anterior">«</button>
            <button class="btn btn--pequeno" data-nav="mes-1" title="Mês anterior">‹</button>
            <button class="btn btn--pequeno" data-nav="hoje">Hoje</button>
            <button class="btn btn--pequeno" data-nav="mes+1" title="Mês seguinte">›</button>
            <button class="btn btn--pequeno" data-nav="ano+1" title="Ano seguinte">»</button>
          </div>
        </div>
        <div class="abas" style="margin:0;padding:0 .6rem">
          <div class="aba" data-visual="dia">Dia</div>
          <div class="aba" data-visual="semana">Semana</div>
          <div class="aba ativa" data-visual="mes">Mês</div>
          <div class="aba" data-visual="lista">Lista de prazos</div>
        </div>
        <div id="area-calendario"></div>
      </section>

      <section class="pilha">
        <div class="cartao">
          <div class="cartao__cabecalho"><h3>Prioridades</h3>
            <a href="#/prazos" class="mini">ver todos</a></div>
          <div class="cartao__corpo cartao__corpo--liso rolagem" id="prioridades"></div>
        </div>
        <div class="cartao">
          <div class="cartao__cabecalho"><h3>Publicações a conferir</h3>
            <a href="#/publicacoes" class="mini">abrir fila</a></div>
          <div class="cartao__corpo" id="mini-publicacoes"></div>
        </div>
      </section>
    </div>
  </div>`);

  const prioridades = [
    ...pauta.vencidos.map((p) => evento(p, 'prazo')),
    ...pauta.hoje.map((p) => evento(p, 'prazo')),
    ...pauta.proximos3.map((p) => evento(p, 'prazo')),
  ];
  qs('#prioridades', tela).innerHTML = listaEventos(prioridades, 'Nenhum prazo crítico. Agenda sob controle.');

  qs('#mini-publicacoes', tela).innerHTML = pauta.publicacoes.length
    ? `<div class="aviso aviso--info">${pauta.publicacoes.length} publicação(ões) aguardando confirmação de prazo.</div>`
      + pauta.publicacoes.slice(0, 3).map((p) => `<div class="mini" style="margin-bottom:.4rem">
          <span class="mono">${esc(fmtCNJ(p.numeroCNJ))}</span> — ${esc(String(p.conteudo).slice(0, 90))}…</div>`).join('')
    : '<div class="mudo mini">Nenhuma publicação pendente.</div>';

  renderCalendario(tela);

  delegar(tela, 'click', '[data-nav]', (_e, el) => {
    const acao = el.dataset.nav;
    if (acao === 'hoje') { estadoCal.ano = new Date().getFullYear(); estadoCal.mes = new Date().getMonth(); }
    if (acao === 'mes-1') { estadoCal.mes -= 1; }
    if (acao === 'mes+1') { estadoCal.mes += 1; }
    if (acao === 'ano-1') { estadoCal.ano -= 1; }
    if (acao === 'ano+1') { estadoCal.ano += 1; }
    if (estadoCal.mes < 0) { estadoCal.mes = 11; estadoCal.ano -= 1; }
    if (estadoCal.mes > 11) { estadoCal.mes = 0; estadoCal.ano += 1; }
    renderCalendario(tela);
  });
  delegar(tela, 'click', '.aba[data-visual]', (_e, el) => {
    estadoCal.visual = el.dataset.visual;
    tela.querySelectorAll('.aba[data-visual]').forEach((a) => a.classList.toggle('ativa', a === el));
    renderCalendario(tela);
  });
  delegar(tela, 'click', '[data-acao="pauta"]', abrirPauta);
  delegar(tela, 'click', '[data-acao="novo-prazo"]', () => abrirFormularioPrazo({}, () => ir('dashboard')));
  delegar(tela, 'click', '.lista__item[data-rota]', (_e, el) => el.dataset.rota && ir(el.dataset.rota));
  ligarIndicadores(qs('#indicadores', tela));
  return tela;
}

const evento = (p) => ({
  id: p.id, tipoRegistro: 'prazo', data: p.dataVencimento, titulo: `${p.tipoRotulo}${p.descricao ? ` — ${p.descricao}` : ''}`,
  processoId: p.processoId, clienteId: p.clienteId, responsavelId: p.responsavelId,
  prioridade: p.prioridade, status: p.status, situacao: p.situacao, rota: `#/prazos/${p.id}`,
});

function renderCalendario(tela) {
  const area = qs('#area-calendario', tela);
  const { ano, mes, visual } = estadoCal;
  qs('#cal-mes', tela).textContent = `${MESES[mes]}/${ano}`;
  area.innerHTML = '';

  if (visual === 'mes') {
    const de = iso(new Date(ano, mes, 1)), ate = iso(new Date(ano, mes, diasNoMes(ano, mes)));
    const eventos = eventosAgenda({ de: addDays(de, -7), ate: addDays(ate, 7) });
    area.appendChild(calendarioMensal({ ano, mes, eventos,
      aoClicarDia: (dia) => detalhesDoDia(dia, eventos, modal) }));
    return;
  }
  if (visual === 'dia') {
    const eventos = eventosAgenda({ de: hoje(), ate: hoje() });
    area.innerHTML = `<div style="padding:.6rem .8rem" class="mudo mini">${esc(fmtDataExtenso(hoje()))}</div>`
      + listaEventos(eventos, 'Nenhum compromisso hoje.');
    return;
  }
  if (visual === 'semana') {
    const inicio = addDays(hoje(), -((toDate(hoje()).getDay() + 6) % 7));
    const eventos = eventosAgenda({ de: inicio, ate: addDays(inicio, 6) });
    area.innerHTML = `<div style="padding:.6rem .8rem" class="mudo mini">Semana de ${fmtData(inicio)} a ${fmtData(addDays(inicio, 6))}</div>`
      + listaEventos(eventos, 'Nenhum compromisso nesta semana.');
    return;
  }
  const eventos = eventosAgenda({ de: hoje(), ate: addDays(hoje(), 60), filtros: { tipo: 'prazos', pendentes: true } });
  area.innerHTML = listaEventos(eventos, 'Nenhum prazo nos próximos 60 dias.');
}

/* ------------------------------------------ o que preciso fazer hoje? --- */

export function abrirPauta() {
  const p = pautaDoDia();
  const bloco = (icone, titulo, itens, render, rota) => `
    <div style="margin-bottom:.9rem">
      <div class="linha linha--entre">
        <h3>${icone} ${esc(titulo)} <span class="selo">${itens.length}</span></h3>
        ${rota ? `<a href="${rota}" class="mini">abrir</a>` : ''}
      </div>
      ${itens.length ? `<ul class="lista">${itens.slice(0, 6).map(render).join('')}</ul>`
    : '<div class="mini mudo">Nada pendente.</div>'}
    </div>`;

  const linhaPrazo = (x) => `<li class="lista__item" data-rota="#/prazos/${x.id}">
    <span class="lista__faixa" style="background:var(--c-fatal)"></span>
    <div class="lista__corpo"><div class="lista__titulo">${esc(x.tipoRotulo)} — ${esc(x.clienteNome)}</div>
    <div class="lista__meta"><span class="mono">${esc(x.numeroCNJ)}</span>
    <span>resp. ${esc(x.responsavelNome)}</span></div></div>
    <div class="lista__lado">${esc(fmtData(x.dataVencimento))}</div></li>`;

  modal({
    titulo: `O que preciso fazer hoje — ${fmtData(hoje())}`,
    largo: true,
    conteudo: `<div>
      ${bloco('🔴', 'Vencidos e não concluídos', p.vencidos, linhaPrazo, '#/prazos')}
      ${bloco('🔴', 'Vencem hoje', p.hoje, linhaPrazo, '#/prazos')}
      ${bloco('🟠', 'Próximos 3 dias', p.proximos3, linhaPrazo, '#/prazos')}
      ${bloco('📄', 'Publicações aguardando conferência', p.publicacoes,
    (x) => `<li class="lista__item" data-rota="#/publicacoes/${x.id}">
        <span class="lista__faixa" style="background:var(--c-publicacao)"></span>
        <div class="lista__corpo"><div class="lista__titulo mono">${esc(x.numeroCNJ)}</div>
        <div class="lista__meta">${esc(String(x.conteudo).slice(0, 110))}…</div></div></li>`, '#/publicacoes')}
      ${bloco('📅', 'Audiências hoje e nos próximos 7 dias', [...p.audienciasHoje, ...p.audienciasSemana],
    (x) => `<li class="lista__item" data-rota="#/audiencias/${x.id}">
        <span class="lista__faixa" style="background:var(--c-audiencia)"></span>
        <div class="lista__corpo"><div class="lista__titulo">${esc(fmtData(x.data))} ${esc(x.hora || '')} — ${esc(x.modalidade || '')}</div></div></li>`,
    '#/audiencias')}
      ${bloco('✅', 'Tarefas pendentes', p.tarefas,
    (x) => `<li class="lista__item" data-rota="#/tarefas/${x.id}">
        <span class="lista__faixa" style="background:var(--c-tarefa)"></span>
        <div class="lista__corpo"><div class="lista__titulo">${esc(x.titulo)}</div>
        <div class="lista__meta">${x.dataVencimento ? esc(fmtData(x.dataVencimento)) : 'sem prazo'}</div></div></li>`,
    '#/tarefas')}
      ${bloco('📣', 'Clientes sem contato há mais de 30 dias', p.clientesParaInformar,
    (x) => `<li class="lista__item" data-rota="#/clientes/${x.id}">
        <div class="lista__corpo"><div class="lista__titulo">${esc(x.nome)}</div></div></li>`, '#/clientes')}
    </div>`,
    acoes: [{ rotulo: 'Fechar', classe: 'btn--primario', aoClicar: (fechar) => fechar() }],
    aoAbrir: (corpo, fechar) => {
      delegar(corpo, 'click', '[data-rota]', (_e, el) => { fechar(); ir(el.dataset.rota); });
    },
  });
}
