// Financeiro do escritório: contratos de honorários e suas parcelas, cobrança
// dos inadimplentes, receitas de demandas judiciais e o resumo do ano.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, cartaoIndicador, opcoesClientes } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { nomeCliente } from '../core/dominio.js';
import { fmtMoeda, fmtData, hoje, addMonths } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';
import { baixarArquivo } from '../core/integracoes.js';
import {
  FORMAS_PAGAMENTO, rotuloForma, gerarParcelas, somaParcelas, parcelasDo, situacaoParcela,
  terminoDoContrato, arquivarContratosEncerrados, clientesComParcelasEmAberto,
  registrarPagamento, mensagemCobranca, linkWhatsApp, telefoneInternacional, registrarCobranca,
  cobrancasDaParcela, receitasDoMes, totalDasReceitas, parteDaReceita, resumoAnual, csvDoResumo,
  casaBusca, mesCorrente, mesAnterior, mesSeguinte, podeAvancar, diasDeAtraso,
} from '../core/financas.js';

const SELO = { paga: 'ok', atrasada: 'fatal', pendente: 'neutro' };

/** "2026-03" lido como "mar/2026"; o CSV mantém a forma técnica. */
const rotuloMes = (chave) => {
  const [ano, mes] = chave.split('-');
  return `${new Date(`${chave}-02T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')}/${ano}`;
};

export function financeiro() {
  definirTitulo('Financeiro');

  // Contrato cujo termo passou e cujas parcelas estão quitadas sai da vista.
  arquivarContratosEncerrados();

  const estado = {
    aba: 'contratos',
    statusContrato: 'ativo',
    buscaContrato: '',
    clienteAberto: null,
    filtroParcela: 'aberto',
    buscaParcela: '',
    clienteCobranca: null,
    mesReceitas: mesCorrente(),
    buscaReceita: '',
    ano: Number(hoje().slice(0, 4)),
  };

  const tela = h(`<div>
    ${cabecalhoPagina('Financeiro',
    '<button class="btn btn--primario" data-acao="novo-contrato">Novo contrato</button>',
    'Honorários contratados, parcelas, cobrança e receitas judiciais.')}
    <div class="abas">
      <div class="aba ativa" data-aba="contratos">Contratos</div>
      <div class="aba" data-aba="parcelas">Parcelas</div>
      <div class="aba" data-aba="cobrancas">Cobranças</div>
      <div class="aba" data-aba="receitas">Receitas judiciais</div>
      <div class="aba" data-aba="relatorio">Relatório</div>
    </div>
    <div id="painel"></div>
  </div>`);

  const desenhar = () => {
    tela.querySelectorAll('.aba[data-aba]').forEach((a) =>
      a.classList.toggle('ativa', a.dataset.aba === estado.aba));
    qs('#painel', tela).innerHTML = paineis[estado.aba]();
  };

  /* ------------------------------------------------------- contratos ----- */

  const paineis = {
    contratos() {
      const lista = db.listar('financeiro')
        .filter((c) => (estado.statusContrato === 'arquivado'
          ? c.status === 'arquivado' : c.status !== 'arquivado'))
        .filter((c) => casaBusca(estado.buscaContrato, nomeCliente(c.clienteId), c.descricao))
        .sort((a, b) => String(b.dataContrato || b.criadoEm).localeCompare(String(a.dataContrato || a.criadoEm)));

      return `<div class="filtros">
        <select data-filtro="statusContrato">
          <option value="ativo" ${estado.statusContrato === 'ativo' ? 'selected' : ''}>Ativos</option>
          <option value="arquivado" ${estado.statusContrato === 'arquivado' ? 'selected' : ''}>Arquivados</option>
        </select>
        <input data-filtro="buscaContrato" type="search" placeholder="Cliente ou descrição…"
          value="${esc(estado.buscaContrato)}">
      </div>
      <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
      ${lista.length ? `<table class="tabela">
        <thead><tr><th>Cliente</th><th>Descrição</th><th>Valor total</th><th>Contrato</th>
          <th>Término</th><th>Pagamento</th><th>Parcelas</th><th></th></tr></thead>
        <tbody>${lista.map((c) => {
    const parcelas = parcelasDo(c);
    const abertas = parcelas.filter((p) => situacaoParcela(p) !== 'paga').length;
    return `<tr>
            <td>${esc(nomeCliente(c.clienteId))}</td>
            <td>${esc(c.descricao || '—')}</td>
            <td class="negrito">${esc(fmtMoeda(c.valorContratado))}</td>
            <td>${esc(fmtData(c.dataContrato || c.criadoEm))}</td>
            <td>${esc(fmtData(terminoDoContrato(c)) || '—')}</td>
            <td><span class="selo selo--neutro">${esc(rotuloForma(c.formaPagamento))}</span></td>
            <td>${parcelas.length}x${abertas ? ` · <span class="selo selo--proximo">${abertas} em aberto</span>` : ''}</td>
            <td class="linha">
              <button class="btn btn--pequeno" data-recibo="${c.id}">Recibo</button>
              <button class="btn btn--pequeno" data-arquivar="${c.id}">${c.status === 'arquivado' ? 'Restaurar' : 'Arquivar'}</button>
              <button class="btn btn--pequeno btn--perigo" data-excluir="${c.id}">Excluir</button>
            </td></tr>`;
  }).join('')}</tbody></table>`
    : '<div class="vazio"><span class="ico">💰</span>Nenhum contrato nesta situação.</div>'}
      </div></div>`;
    },

    /* -------------------------------------------------------- parcelas ---- */

    parcelas() {
      if (!estado.clienteAberto) {
        const grupos = clientesComParcelasEmAberto()
          .filter((g) => casaBusca(estado.buscaParcela, nomeCliente(g.clienteId)));
        return `<div class="filtros">
          <input data-filtro="buscaParcela" type="search" placeholder="Cliente…"
            value="${esc(estado.buscaParcela)}">
        </div>
        ${grupos.length ? `<div class="cartao"><div class="cartao__corpo cartao__corpo--liso">
          <ul class="lista">${grupos.map((g) => `<li class="lista__item linha linha--entre"
            data-cliente="${esc(g.clienteId)}" style="cursor:pointer">
            <div>
              <div class="negrito">${esc(nomeCliente(g.clienteId))}</div>
              <div class="mini mudo">${g.parcelas.length} parcela(s) em aberto</div>
            </div>
            <div class="linha">
              ${g.totalAtrasado ? `<span class="selo selo--fatal">${esc(fmtMoeda(g.totalAtrasado))} em atraso</span>` : ''}
              ${g.totalPendente ? `<span class="selo selo--neutro">${esc(fmtMoeda(g.totalPendente))} a vencer</span>` : ''}
            </div></li>`).join('')}</ul>
        </div></div>` : '<div class="vazio"><span class="ico">✅</span>Nenhuma parcela em aberto.</div>'}`;
      }

      const contratos = db.listar('financeiro').filter((c) => c.clienteId === estado.clienteAberto);
      const itens = contratos.flatMap((c) => parcelasDo(c)
        .map((p) => ({ ...p, situacao: situacaoParcela(p), contrato: c })))
        .filter((p) => (estado.filtroParcela === 'aberto' ? p.situacao !== 'paga'
          : estado.filtroParcela === 'todos' ? true : p.situacao === estado.filtroParcela))
        .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));

      return `${voltar(nomeCliente(estado.clienteAberto))}
      <div class="filtros">
        <select data-filtro="filtroParcela">
          ${[['aberto', 'Em aberto'], ['todos', 'Todas'], ['pendente', 'A vencer'],
    ['atrasada', 'Atrasadas'], ['paga', 'Pagas']]
    .map(([v, r]) => `<option value="${v}" ${estado.filtroParcela === v ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
      ${itens.length ? `<table class="tabela">
        <thead><tr><th>Parcela</th><th>Contrato</th><th>Valor</th><th>Vencimento</th>
          <th>Pagamento</th><th>Situação</th><th></th></tr></thead>
        <tbody>${itens.map((p) => `<tr ${p.situacao === 'atrasada' ? 'class="linha--atraso"' : ''}>
          <td>${esc(p.rotulo)}</td>
          <td class="mini">${esc(p.contrato.descricao || '—')}</td>
          <td class="negrito">${esc(fmtMoeda(p.valor))}</td>
          <td>${esc(fmtData(p.vencimento))}
            ${p.situacao === 'atrasada' ? `<span class="mini">há ${diasDeAtraso(p)} dia(s)</span>` : ''}</td>
          <td>${p.pagoEm ? `${esc(fmtData(p.pagoEm))}${Number(p.valorPago) !== Number(p.valor)
    ? ` <span class="mini">(${esc(fmtMoeda(p.valorPago))})</span>` : ''}` : '—'}</td>
          <td><span class="selo selo--${SELO[p.situacao]}">${p.situacao}</span></td>
          <td>${p.situacao === 'paga' ? ''
    : `<button class="btn btn--pequeno" data-pagar="${p.contrato.id}:${p.numero}">Registrar pagamento</button>`}</td>
        </tr>`).join('')}</tbody></table>`
    : '<div class="vazio">Nenhuma parcela nesta situação.</div>'}
      </div></div>`;
    },

    /* ------------------------------------------------------- cobranças ---- */

    cobrancas() {
      if (!estado.clienteCobranca) {
        const grupos = clientesComParcelasEmAberto({ somenteVencidas: true });
        return grupos.length ? `<div class="grade grade--2">
          ${grupos.map((g) => `<section class="cartao" data-cobrar-cliente="${esc(g.clienteId)}"
            style="cursor:pointer"><div class="cartao__corpo">
            <div class="linha linha--entre">
              <h3>${esc(nomeCliente(g.clienteId))}</h3>
              <span class="selo selo--fatal">${esc(fmtMoeda(g.totalAtrasado))}</span>
            </div>
            <div class="mini mudo">${g.atrasadas} parcela(s) vencida(s)
              ${telefoneInternacional(db.obter('clientes', g.clienteId)?.telefone) ? ''
    : ' · sem telefone cadastrado'}</div>
          </div></section>`).join('')}
        </div>` : '<div class="vazio"><span class="ico">🎉</span>Nenhuma parcela vencida.</div>';
      }

      const cliente = db.obter('clientes', estado.clienteCobranca);
      const vencidas = clientesComParcelasEmAberto({ somenteVencidas: true })
        .find((g) => g.clienteId === estado.clienteCobranca)?.parcelas || [];

      return `${voltar(nomeCliente(estado.clienteCobranca))}
      ${telefoneInternacional(cliente?.telefone) ? '' : `<div class="aviso aviso--alerta">
        Cliente sem telefone cadastrado. Informe o número no cadastro do cliente para cobrar
        pelo WhatsApp.</div>`}
      <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
      <table class="tabela">
        <thead><tr><th>Parcela</th><th>Vencimento</th><th>Atraso</th><th>Valor</th>
          <th>Última cobrança</th><th></th></tr></thead>
        <tbody>${vencidas.map((p) => {
    const anterior = cobrancasDaParcela(p.contratoId, p.numero)[0];
    return `<tr class="linha--atraso">
          <td>${esc(p.rotulo)}</td>
          <td>${esc(fmtData(p.vencimento))}</td>
          <td>${diasDeAtraso(p)} dia(s)</td>
          <td class="negrito">${esc(fmtMoeda(p.valor))}</td>
          <td class="mini">${anterior ? esc(fmtData(String(anterior.dataCobranca).slice(0, 10))) : '—'}</td>
          <td><button class="btn btn--pequeno btn--primario"
            data-cobrar="${p.contratoId}:${p.numero}">Cobrar</button></td>
        </tr>`;
  }).join('')}</tbody></table>
      </div></div>`;
    },

    /* -------------------------------------------------------- receitas ---- */

    receitas() {
      const lista = receitasDoMes(estado.mesReceitas)
        .filter((r) => casaBusca(estado.buscaReceita,
          parteDaReceita(r, nomeCliente), r.descricao, r.numeroProcesso));
      const [ano, mes] = estado.mesReceitas.split('-');
      const nomeMes = new Date(`${estado.mesReceitas}-02T12:00:00`)
        .toLocaleDateString('pt-BR', { month: 'long' });

      return `<div class="linha linha--entre" style="margin-bottom:.6rem">
        <div class="linha">
          <button class="btn btn--pequeno" data-mes="anterior">◀</button>
          <strong>${esc(nomeMes)}/${esc(ano)}</strong>
          ${estado.mesReceitas < mesCorrente() ? '<span class="selo selo--neutro">arquivo</span>' : ''}
          <button class="btn btn--pequeno" data-mes="proximo"
            ${podeAvancar(estado.mesReceitas) ? '' : 'disabled'}>▶</button>
        </div>
        <div class="linha">
          <span class="mini mudo">Total do mês</span>
          <strong>${esc(fmtMoeda(totalDasReceitas(lista)))}</strong>
          <button class="btn btn--primario btn--pequeno" data-acao="nova-receita">Nova receita</button>
        </div>
      </div>
      <div class="filtros">
        <input data-filtro="buscaReceita" type="search" placeholder="Parte, descrição ou processo…"
          value="${esc(estado.buscaReceita)}">
      </div>
      <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
      ${lista.length ? `<table class="tabela">
        <thead><tr><th>Parte</th><th>Descrição</th><th>Processo</th><th>Valor</th>
          <th>Recebimento</th><th></th></tr></thead>
        <tbody>${lista.map((r) => `<tr>
          <td>${esc(parteDaReceita(r, nomeCliente))}</td>
          <td>${esc(r.descricao)}</td>
          <td class="mono mini">${esc(r.numeroProcesso || '—')}</td>
          <td class="negrito">${esc(fmtMoeda(r.valor))}</td>
          <td>${esc(fmtData(r.dataRecebimento))}</td>
          <td class="linha">
            <button class="btn btn--pequeno" data-editar-receita="${r.id}">Editar</button>
            <button class="btn btn--pequeno btn--perigo" data-excluir-receita="${r.id}">Excluir</button>
          </td></tr>`).join('')}</tbody></table>`
    : '<div class="vazio">Nenhuma receita lançada neste mês.</div>'}
      </div></div>`;
    },

    /* ------------------------------------------------------- relatório ---- */

    relatorio() {
      const r = resumoAnual(estado.ano);
      const anos = [estado.ano - 2, estado.ano - 1, estado.ano, estado.ano + 1];

      return `<div class="linha linha--entre" style="margin-bottom:.7rem">
        <select data-filtro="ano">
          ${anos.map((a) => `<option value="${a}" ${a === estado.ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <button class="btn btn--pequeno" data-acao="csv">Exportar CSV</button>
      </div>
      <div class="grade grade--indicadores grade--compacta" style="margin-bottom:1rem">
        ${cartaoIndicador({ rotulo: 'Recebido (parcelas)', valor: fmtMoeda(r.totais.recebido), variante: 'ok' })}
        ${cartaoIndicador({ rotulo: 'Receitas judiciais', valor: fmtMoeda(r.totais.judiciais) })}
        ${cartaoIndicador({ rotulo: 'Total recebido', valor: fmtMoeda(r.totais.total), variante: 'ok' })}
        ${cartaoIndicador({ rotulo: 'A receber', valor: fmtMoeda(r.totais.pendente) })}
        ${cartaoIndicador({ rotulo: 'Vencido', valor: fmtMoeda(r.totais.vencido),
    variante: r.totais.vencido ? 'fatal' : 'ok' })}
      </div>
      <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
        <table class="tabela">
          <thead><tr><th>Mês</th><th>Valor total</th><th>Recebido (parcelas)</th>
            <th>Receitas judiciais</th><th>Pendente</th><th>Vencido</th><th>Parcelas</th></tr></thead>
          <tbody>${r.linhas.map((l) => `<tr>
            <td>${esc(rotuloMes(l.mes))}</td>
            <td class="negrito">${esc(fmtMoeda(l.total))}</td>
            <td>${esc(fmtMoeda(l.recebido))}</td>
            <td>${esc(fmtMoeda(l.judiciais))}</td>
            <td>${esc(fmtMoeda(l.pendente))}</td>
            <td${l.vencido ? ' class="texto-fatal"' : ''}>${esc(fmtMoeda(l.vencido))}</td>
            <td>${l.parcelas}</td></tr>`).join('')}</tbody>
        </table>
      </div></div>`;
    },
  };

  const voltar = (titulo) => `<div class="linha" style="margin-bottom:.6rem">
    <button class="btn btn--pequeno" data-acao="voltar-lista">← Voltar</button>
    <strong>${esc(titulo)}</strong></div>`;

  /* ---------------------------------------------------------- ações ------ */

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    estado.aba = el.dataset.aba;
    estado.clienteAberto = null;
    estado.clienteCobranca = null;
    desenhar();
  });
  delegar(tela, 'change', '[data-filtro]', (_e, el) => {
    estado[el.dataset.filtro] = el.dataset.filtro === 'ano' ? Number(el.value) : el.value;
    desenhar();
  });
  delegar(tela, 'input', '[type="search"][data-filtro]', (_e, el) => {
    estado[el.dataset.filtro] = el.value;
    desenhar();
    qs(`[data-filtro="${el.dataset.filtro}"]`, tela)?.focus();
  });
  delegar(tela, 'click', '[data-acao="voltar-lista"]', () => {
    estado.clienteAberto = null; estado.clienteCobranca = null; desenhar();
  });
  delegar(tela, 'click', '[data-cliente]', (_e, el) => {
    estado.clienteAberto = el.dataset.cliente; estado.filtroParcela = 'aberto'; desenhar();
  });
  delegar(tela, 'click', '[data-cobrar-cliente]', (_e, el) => {
    estado.clienteCobranca = el.dataset.cobrarCliente; desenhar();
  });

  delegar(tela, 'click', '[data-acao="novo-contrato"]', () => abrirContrato(desenhar));
  delegar(tela, 'click', '[data-arquivar]', (_e, el) => {
    const c = db.obter('financeiro', el.dataset.arquivar);
    const novo = c.status === 'arquivado' ? 'ativo' : 'arquivado';
    db.atualizar('financeiro', c.id, { status: novo },
      novo === 'arquivado' ? 'Contrato arquivado' : 'Contrato restaurado');
    desenhar();
  });
  delegar(tela, 'click', '[data-excluir]', async (_e, el) => {
    if (!await confirmar({ titulo: 'Excluir contrato',
      mensagem: 'O contrato e as suas parcelas saem da vista. Tem certeza?', perigo: true })) return;
    db.remover('financeiro', el.dataset.excluir);
    desenhar();
  });
  delegar(tela, 'click', '[data-pagar]', (_e, el) => {
    const [contratoId, numero] = el.dataset.pagar.split(':');
    abrirPagamento(contratoId, Number(numero), desenhar);
  });
  delegar(tela, 'click', '[data-cobrar]', (_e, el) => {
    const [contratoId, numero] = el.dataset.cobrar.split(':');
    cobrar(contratoId, Number(numero), desenhar);
  });

  delegar(tela, 'click', '[data-mes]', (_e, el) => {
    if (el.dataset.mes === 'proximo' && !podeAvancar(estado.mesReceitas)) return;
    estado.mesReceitas = el.dataset.mes === 'anterior'
      ? mesAnterior(estado.mesReceitas) : mesSeguinte(estado.mesReceitas);
    desenhar();
  });
  delegar(tela, 'click', '[data-acao="nova-receita"]', () => abrirReceita(null, desenhar));
  delegar(tela, 'click', '[data-editar-receita]', (_e, el) =>
    abrirReceita(db.obter('receitas', el.dataset.editarReceita), desenhar));
  delegar(tela, 'click', '[data-excluir-receita]', async (_e, el) => {
    if (!await confirmar({ titulo: 'Excluir receita', mensagem: 'Tem certeza?', perigo: true })) return;
    db.remover('receitas', el.dataset.excluirReceita);
    desenhar();
  });

  delegar(tela, 'click', '[data-acao="csv"]', () => {
    baixarArquivo(`relatorio-${estado.ano}.csv`, csvDoResumo(resumoAnual(estado.ano)));
  });
  delegar(tela, 'click', '[data-recibo]', (_e, el) => emitirRecibo(el.dataset.recibo));

  desenhar();
  return tela;
}

/* ------------------------------------------------------------ recibo ----- */

function emitirRecibo(contratoId) {
  const c = db.obter('financeiro', contratoId);
  const pagas = parcelasDo(c).filter((p) => p.pagoEm);
  const total = pagas.reduce((s, p) => s + Number(p.valorPago ?? p.valor ?? 0), 0);
  baixarArquivo(`recibo-${c.id}.txt`, [
    'RECIBO DE HONORÁRIOS ADVOCATÍCIOS', '',
    db.config().escritorio.nome, '',
    `Recebi(emos) de ${nomeCliente(c.clienteId)} a importância de ${fmtMoeda(total)},`,
    `referente a ${c.descricao}.`, '',
    `Parcelas quitadas: ${pagas.map((p) => `${p.rotulo} (${fmtData(p.pagoEm)})`).join(', ') || 'nenhuma'}`,
    '', db.config().escritorio.nome, fmtData(hoje()),
  ].join('\n'));
}

/* ---------------------------------------------------------- contrato ----- */

/**
 * Cadastro do contrato. A forma de pagamento decide quais campos se pedem: não
 * há por que perguntar número de parcelas de contrato à vista.
 */
function abrirContrato(aoConcluir) {
  const campos = [
    { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes(),
      obrigatorio: true, largura: 2 },
    { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', obrigatorio: true },
    { nome: 'valorContratado', rotulo: 'Valor total', tipo: 'money', obrigatorio: true },
    { nome: 'dataContrato', rotulo: 'Data do contrato', tipo: 'date', obrigatorio: true },
    { nome: 'formaPagamento', rotulo: 'Forma de pagamento', tipo: 'select', vazio: false,
      opcoes: FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.rotulo })) },
    { nome: 'dataPagamentoAvista', rotulo: 'Data do pagamento', tipo: 'date',
      ajuda: 'Em branco, vale a data do contrato.' },
    { nome: 'valorEntrada', rotulo: 'Valor da entrada', tipo: 'money' },
    { nome: 'numeroParcelas', rotulo: 'Número de parcelas', tipo: 'number', atributos: { min: 1 } },
    { nome: 'inicioParcelas', rotulo: 'Início do parcelamento', tipo: 'date',
      ajuda: 'Em branco, vale a data do contrato.' },
    { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largura: 3 },
  ];

  const previa = h('<div class="mini mudo" style="margin-top:.5rem"></div>');

  const { form } = modalFormulario({
    titulo: 'Contrato de honorários', largo: true, campos, extras: previa,
    valores: { dataContrato: hoje(), formaPagamento: 'a_vista', numeroParcelas: 2, valorEntrada: 0 },
    rotuloSalvar: 'Cadastrar',
    aoSalvar: (d, { avisos }) => {
      const forma = d.formaPagamento;
      if (forma === 'entrada_parcelado' && !(Number(d.valorEntrada) > 0)) {
        avisos.innerHTML = '<div class="aviso aviso--alerta">Informe o valor da entrada.</div>';
        return false;
      }
      if (forma === 'entrada_parcelado' && Number(d.valorEntrada) >= Number(d.valorContratado)) {
        avisos.innerHTML = '<div class="aviso aviso--alerta">A entrada precisa ser menor que o '
          + 'valor contratado.</div>';
        return false;
      }
      if (forma === 'parcelado' && Number(d.numeroParcelas) < 2) {
        avisos.innerHTML = '<div class="aviso aviso--alerta">Parcelamento exige ao menos duas '
          + 'parcelas. Para pagamento único, escolha "À vista".</div>';
        return false;
      }

      const parcelas = gerarParcelas({
        valorTotal: d.valorContratado, dataContrato: d.dataContrato, formaPagamento: forma,
        numeroParcelas: d.numeroParcelas, valorEntrada: d.valorEntrada,
        inicioParcelas: d.inicioParcelas, dataPagamentoAvista: d.dataPagamentoAvista,
      });
      db.inserir('financeiro', {
        clienteId: d.clienteId, descricao: d.descricao, valorContratado: d.valorContratado,
        dataContrato: d.dataContrato, formaPagamento: forma,
        valorEntrada: forma === 'entrada_parcelado' ? d.valorEntrada : 0,
        numeroParcelas: parcelas.filter((p) => p.numero > 0).length,
        observacoes: d.observacoes, status: 'ativo', parcelas,
      }, 'Contrato cadastrado');
      aviso('Contrato cadastrado.', 'ok');
      aoConcluir?.();
      return true;
    },
  });

  // Campos conforme a forma escolhida, e prévia do que será gerado.
  const mostrar = (nome, visivel) => {
    const el = form.elements[nome]?.closest('.campo');
    if (el) el.style.display = visivel ? '' : 'none';
  };
  const ajustar = () => {
    const forma = form.elements.formaPagamento.value;
    mostrar('dataPagamentoAvista', forma === 'a_vista');
    mostrar('valorEntrada', forma === 'entrada_parcelado');
    mostrar('numeroParcelas', forma !== 'a_vista');
    mostrar('inicioParcelas', forma !== 'a_vista');

    const parcelas = gerarParcelas({
      valorTotal: Number(form.elements.valorContratado.value),
      dataContrato: form.elements.dataContrato.value || hoje(),
      formaPagamento: forma,
      numeroParcelas: Number(form.elements.numeroParcelas.value),
      valorEntrada: Number(form.elements.valorEntrada.value),
      inicioParcelas: form.elements.inicioParcelas.value,
      dataPagamentoAvista: form.elements.dataPagamentoAvista.value,
    });
    previa.innerHTML = parcelas.length
      ? `Serão geradas ${parcelas.length} parcela(s), de ${fmtData(parcelas[0].vencimento)} a `
        + `${fmtData(parcelas.at(-1).vencimento)}, somando ${fmtMoeda(somaParcelas(parcelas))}.`
        + (parcelas[0].numero === 0 ? ' A entrada já entra como quitada.' : '')
      : 'Informe o valor para ver as parcelas.';
  };
  form.addEventListener('input', ajustar);
  form.addEventListener('change', ajustar);
  ajustar();
}

/* --------------------------------------------------------- pagamento ----- */

function abrirPagamento(contratoId, numero, aoConcluir) {
  const parcela = parcelasDo(db.obter('financeiro', contratoId)).find((p) => p.numero === numero);
  modalFormulario({
    titulo: `Pagamento — ${parcela?.rotulo || 'parcela'}`,
    campos: [
      { nome: 'data', rotulo: 'Data do pagamento', tipo: 'date', obrigatorio: true },
      { nome: 'valorPago', rotulo: 'Valor pago', tipo: 'money', obrigatorio: true,
        ajuda: 'Pagamento parcial ou com acréscimo pode ser informado aqui.' },
    ],
    valores: { data: hoje(), valorPago: parcela?.valor },
    rotuloSalvar: 'Registrar',
    aoSalvar: (d) => {
      registrarPagamento(contratoId, numero, { data: d.data, valorPago: d.valorPago });
      aviso('Pagamento registrado.', 'ok');
      aoConcluir?.();
    },
  });
}

/* ---------------------------------------------------------- cobrança ----- */

function cobrar(contratoId, numero, aoConcluir) {
  const contrato = db.obter('financeiro', contratoId);
  const parcela = parcelasDo(contrato).find((p) => p.numero === numero);
  const cliente = db.obter('clientes', contrato.clienteId);
  const telefone = telefoneInternacional(cliente?.whatsapp || cliente?.telefone);

  if (!telefone) {
    aviso('Cliente sem telefone cadastrado. Informe o número no cadastro do cliente.', 'erro');
    return;
  }

  const mensagem = mensagemCobranca({
    nome: cliente.nome, numero, vencimento: parcela.vencimento, valor: parcela.valor,
  });

  modalFormulario({
    titulo: 'Cobrança pelo WhatsApp', largo: true,
    campos: [{ nome: 'mensagem', rotulo: 'Mensagem', tipo: 'textarea', largura: 3,
      obrigatorio: true, ajuda: 'Revise antes de enviar. O texto vai como está.' }],
    valores: { mensagem },
    rotuloSalvar: 'Abrir WhatsApp',
    aoSalvar: (d) => {
      const url = linkWhatsApp(telefone, d.mensagem);
      const aberta = window.open(url, '_blank', 'noopener');
      // Bloqueio de janela não pode impedir a cobrança: segue na própria aba.
      if (!aberta) window.location.href = url;

      registrarCobranca({ clienteId: contrato.clienteId, contratoId, numero });
      db.inserir('comunicacoes', {
        clienteId: contrato.clienteId, canal: 'whatsapp', direcao: 'saida',
        destinatario: telefone, mensagem: d.mensagem, status: 'aberto_no_dispositivo',
        enviadoEm: new Date().toISOString(),
      }, 'Cobrança enviada pelo WhatsApp');
      aviso('Cobrança registrada.', 'ok');
      aoConcluir?.();
    },
  });
}

/* ---------------------------------------------------------- receitas ----- */

/**
 * Receita de demanda judicial, avulsa. A parte pode ser cliente cadastrado ou
 * nome digitado: alvará e sucumbência nem sempre vêm de quem é cliente.
 */
function abrirReceita(receita, aoConcluir) {
  const edicao = Boolean(receita?.id);
  modalFormulario({
    titulo: edicao ? 'Editar receita judicial' : 'Nova receita judicial', largo: true,
    campos: [
      { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes(), largura: 2,
        placeholder: '— informar a parte pelo nome —' },
      { nome: 'nomeParte', rotulo: 'Parte (quando não for cliente)', tipo: 'text' },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', obrigatorio: true, largura: 2 },
      { nome: 'valor', rotulo: 'Valor', tipo: 'money', obrigatorio: true },
      { nome: 'dataRecebimento', rotulo: 'Recebimento', tipo: 'date', obrigatorio: true },
      { nome: 'numeroProcesso', rotulo: 'Número do processo', tipo: 'text', largura: 2 },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largura: 3 },
    ],
    valores: receita || { dataRecebimento: hoje() },
    rotuloSalvar: edicao ? 'Salvar' : 'Lançar',
    aoSalvar: (d, { avisos }) => {
      if (!d.clienteId && !d.nomeParte.trim()) {
        avisos.innerHTML = '<div class="aviso aviso--alerta">Escolha o cliente ou informe o nome '
          + 'da parte.</div>';
        return false;
      }
      const dados = { ...d, clienteId: d.clienteId || null };
      if (edicao) db.atualizar('receitas', receita.id, dados, 'Receita judicial alterada');
      else db.inserir('receitas', dados, 'Receita judicial lançada');
      aviso('Receita registrada.', 'ok');
      aoConcluir?.();
      return true;
    },
  });
}
