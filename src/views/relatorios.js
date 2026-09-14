// Relatórios gerenciais: produtividade, carga de trabalho e volume por cliente.

import { h, qs, esc, delegar } from '../ui/ui.js';
import { cabecalhoPagina, cartaoIndicador } from '../ui/componentes.js';
import { relatorioGerencial } from '../core/dominio.js';
import { hoje, addDays, fmtData } from '../core/util.js';
import { baixarArquivo } from '../core/integracoes.js';
import { definirTitulo } from '../ui/casca.js';

export function relatorios() {
  definirTitulo('Relatórios');
  let de = addDays(hoje(), -30), ate = addDays(hoje(), 30);

  const tela = h(`<div>
    ${cabecalhoPagina('Relatórios gerenciais', '<button class="btn" data-acao="csv">Exportar CSV</button>')}
    <div class="filtros">
      <label class="mini">De <input type="date" data-p="de" value="${de}"></label>
      <label class="mini">Até <input type="date" data-p="ate" value="${ate}"></label>
    </div>
    <div id="conteudo-relatorio"></div>
  </div>`);

  const desenhar = () => {
    const r = relatorioGerencial({ de, ate });
    qs('#conteudo-relatorio', tela).innerHTML = `
      <div class="grade grade--indicadores" style="margin-bottom:1rem">
        ${cartaoIndicador({ rotulo: 'Processos ativos', valor: r.processosAtivos })}
        ${cartaoIndicador({ rotulo: 'Prazos no período', valor: r.prazosNoPeriodo })}
        ${cartaoIndicador({ rotulo: 'Concluídos', valor: r.concluidos, variante: 'ok' })}
        ${cartaoIndicador({ rotulo: 'Vencidos em aberto', valor: r.vencidos, variante: r.vencidos ? 'fatal' : 'ok' })}
        ${cartaoIndicador({ rotulo: 'Audiências', valor: r.audiencias, variante: 'audiencia' })}
        ${cartaoIndicador({ rotulo: 'Publicações', valor: r.publicacoes, variante: 'publicacao' })}
        ${cartaoIndicador({ rotulo: 'Tarefas pendentes', valor: r.tarefasPendentes })}
      </div>

      <div class="grade grade--2">
        <section class="cartao">
          <div class="cartao__cabecalho"><h3>Carga de trabalho e produtividade</h3></div>
          <div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
            <table class="tabela"><thead><tr><th>Profissional</th><th>Processos</th>
              <th>Prazos abertos</th><th>Concluídos no período</th><th>Tarefas</th></tr></thead>
            <tbody>${r.cargaPorAdvogado.map((u) => `<tr><td>${esc(u.nome)}</td><td>${u.processos}</td>
              <td>${u.prazosAbertos}</td><td>${u.concluidos}</td><td>${u.tarefas}</td></tr>`).join('')}</tbody></table>
          </div>
        </section>
        <section class="cartao">
          <div class="cartao__cabecalho"><h3>Processos por cliente</h3></div>
          <div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
            <table class="tabela"><thead><tr><th>Cliente</th><th>Ativos</th><th>Total</th></tr></thead>
            <tbody>${r.processosPorCliente.map((c) => `<tr><td>${esc(c.nome)}</td>
              <td>${c.ativos}</td><td>${c.total}</td></tr>`).join('')}</tbody></table>
          </div>
        </section>
      </div>`;
  };

  delegar(tela, 'change', '[data-p]', (_e, el) => {
    if (el.dataset.p === 'de') de = el.value; else ate = el.value;
    desenhar();
  });
  delegar(tela, 'click', '[data-acao="csv"]', () => {
    const r = relatorioGerencial({ de, ate });
    const linhas = [['Profissional', 'Processos', 'Prazos abertos', 'Concluídos', 'Tarefas'],
      ...r.cargaPorAdvogado.map((u) => [u.nome, u.processos, u.prazosAbertos, u.concluidos, u.tarefas])];
    baixarArquivo(`relatorio-gerencial-${de}_${ate}.csv`,
      linhas.map((l) => l.join(';')).join('\n'), 'text/csv;charset=utf-8');
  });
  desenhar();
  return tela;
}
