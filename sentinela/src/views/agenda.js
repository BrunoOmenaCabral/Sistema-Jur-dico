// Agenda unificada: prazos, tarefas e audiências com filtros e quatro visões.

import { h, qs, esc, delegar, modal, aviso } from '../ui/ui.js';
import {
  cabecalhoPagina, calendarioMensal, listaEventos, detalhesDoDia, opcoesUsuarios, opcoesClientes,
} from '../ui/componentes.js';
import { eventosAgenda } from '../core/dominio.js';
import { MESES, iso, hoje, addDays, diasNoMes, fmtData, toDate, fmtDataExtenso } from '../core/util.js';
import { exportarAgendaICS } from '../core/integracoes.js';
import { ir } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { abrirFormularioPrazo } from './prazos.js';

const estado = {
  ano: new Date().getFullYear(), mes: new Date().getMonth(), visual: 'mes',
  filtros: { tipo: '', responsavelId: '', clienteId: '', urgentes: false, vencidos: false, pendentes: false },
};

export function agenda() {
  definirTitulo('Agenda');
  const tela = h(`<div>
    ${cabecalhoPagina('Agenda', `
      <button class="btn btn--primario" data-acao="novo">Novo prazo</button>
      <button class="btn" data-acao="ics">Exportar .ics</button>`)}
    <div class="filtros">
      <select data-f="tipo"><option value="">Tudo</option><option value="prazos">Somente prazos</option>
        <option value="tarefas">Somente tarefas</option><option value="audiencias">Somente audiências</option></select>
      <select data-f="responsavelId"><option value="">Todos os responsáveis</option>
        ${opcoesUsuarios().map((u) => `<option value="${u.valor}">${esc(u.rotulo)}</option>`).join('')}</select>
      <select data-f="clienteId"><option value="">Todos os clientes</option>
        ${opcoesClientes().map((c) => `<option value="${c.valor}">${esc(c.rotulo)}</option>`).join('')}</select>
      <label class="campo--linha mini"><input type="checkbox" data-fb="urgentes"> urgentes</label>
      <label class="campo--linha mini"><input type="checkbox" data-fb="vencidos"> vencidos</label>
      <label class="campo--linha mini"><input type="checkbox" data-fb="pendentes"> pendentes</label>
    </div>

    <section class="cartao">
      <div class="cal__topo">
        <span class="cal__mes" id="mes"></span>
        <div class="cal__nav">
          <button class="btn btn--pequeno" data-nav="ano-1">«</button>
          <button class="btn btn--pequeno" data-nav="mes-1">‹</button>
          <button class="btn btn--pequeno" data-nav="hoje">Hoje</button>
          <button class="btn btn--pequeno" data-nav="mes+1">›</button>
          <button class="btn btn--pequeno" data-nav="ano+1">»</button>
        </div>
      </div>
      <div class="abas" style="margin:0;padding:0 .6rem">
        <div class="aba" data-visual="dia">Dia</div>
        <div class="aba" data-visual="semana">Semana</div>
        <div class="aba ativa" data-visual="mes">Mês</div>
        <div class="aba" data-visual="lista">Lista</div>
      </div>
      <div id="area"></div>
    </section>
  </div>`);

  const periodo = () => {
    if (estado.visual === 'dia') return [hoje(), hoje()];
    if (estado.visual === 'semana') {
      const i = addDays(hoje(), -((toDate(hoje()).getDay() + 6) % 7));
      return [i, addDays(i, 6)];
    }
    if (estado.visual === 'lista') return [hoje(), addDays(hoje(), 90)];
    const de = iso(new Date(estado.ano, estado.mes, 1));
    return [addDays(de, -7), addDays(iso(new Date(estado.ano, estado.mes, diasNoMes(estado.ano, estado.mes))), 7)];
  };

  const desenhar = () => {
    const [de, ate] = periodo();
    const eventos = eventosAgenda({ de, ate, filtros: estado.filtros });
    qs('#mes', tela).textContent = estado.visual === 'mes'
      ? `${MESES[estado.mes]}/${estado.ano}` : `${fmtData(de)} — ${fmtData(ate)}`;
    const area = qs('#area', tela);
    area.innerHTML = '';
    if (estado.visual === 'mes') {
      area.appendChild(calendarioMensal({ ano: estado.ano, mes: estado.mes, eventos, maxPorDia: 4,
        aoClicarDia: (dia) => detalhesDoDia(dia, eventos, modal) }));
    } else {
      area.innerHTML = `<div style="padding:.6rem .8rem" class="mudo mini">
          ${estado.visual === 'dia' ? esc(fmtDataExtenso(hoje())) : `${eventos.length} compromissos`}</div>`
        + listaEventos(eventos, 'Nenhum compromisso no período.');
    }
    tela.dataset.ultimos = JSON.stringify(eventos.map((e) => e.id));
    tela._eventos = eventos;
  };

  delegar(tela, 'click', '[data-nav]', (_e, el) => {
    const a = el.dataset.nav;
    if (a === 'hoje') { estado.ano = new Date().getFullYear(); estado.mes = new Date().getMonth(); }
    if (a === 'mes-1') estado.mes -= 1;
    if (a === 'mes+1') estado.mes += 1;
    if (a === 'ano-1') estado.ano -= 1;
    if (a === 'ano+1') estado.ano += 1;
    if (estado.mes < 0) { estado.mes = 11; estado.ano -= 1; }
    if (estado.mes > 11) { estado.mes = 0; estado.ano += 1; }
    desenhar();
  });
  delegar(tela, 'click', '.aba[data-visual]', (_e, el) => {
    estado.visual = el.dataset.visual;
    tela.querySelectorAll('.aba[data-visual]').forEach((a) => a.classList.toggle('ativa', a === el));
    desenhar();
  });
  delegar(tela, 'change', '[data-f]', (_e, el) => { estado.filtros[el.dataset.f] = el.value; desenhar(); });
  delegar(tela, 'change', '[data-fb]', (_e, el) => { estado.filtros[el.dataset.fb] = el.checked; desenhar(); });
  delegar(tela, 'click', '.lista__item[data-rota]', (_e, el) => el.dataset.rota && ir(el.dataset.rota));
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioPrazo({}, desenhar));
  delegar(tela, 'click', '[data-acao="ics"]', () => {
    exportarAgendaICS(tela._eventos || []);
    aviso('Agenda exportada. O sistema permanece como fonte principal dos prazos.', 'ok');
  });
  desenhar();
  return tela;
}
