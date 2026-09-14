// Módulo financeiro: honorários contratados, parcelas, recebimentos e inadimplência.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, cartaoIndicador, opcoesClientes, opcoesProcessos } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { nomeCliente, processoDe } from '../core/dominio.js';
import { fmtMoeda, fmtData, hoje, addMonths } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';
import { baixarArquivo } from '../core/integracoes.js';

export function financeiro() {
  definirTitulo('Financeiro');
  const tela = h(`<div>
    ${cabecalhoPagina('Financeiro', '<button class="btn btn--primario" data-acao="novo">Novo contrato de honorários</button>')}
    <div id="painel"></div>
  </div>`);

  const desenhar = () => {
    const contratos = db.listar('financeiro');
    const parcelas = contratos.flatMap((c) => (c.parcelas || []).map((p) => ({ ...p, contrato: c })));
    const total = contratos.reduce((s, c) => s + (Number(c.valorContratado) || 0), 0);
    const recebido = parcelas.filter((p) => p.pagoEm).reduce((s, p) => s + Number(p.valor || 0), 0);
    const vencidas = parcelas.filter((p) => !p.pagoEm && p.vencimento < hoje());
    const aVencer = parcelas.filter((p) => !p.pagoEm && p.vencimento >= hoje());

    qs('#painel', tela).innerHTML = `
      <div class="grade grade--indicadores" style="margin-bottom:1rem">
        ${cartaoIndicador({ rotulo: 'Contratado', valor: fmtMoeda(total) })}
        ${cartaoIndicador({ rotulo: 'Recebido', valor: fmtMoeda(recebido), variante: 'ok' })}
        ${cartaoIndicador({ rotulo: 'A receber', valor: fmtMoeda(aVencer.reduce((s, p) => s + Number(p.valor || 0), 0)) })}
        ${cartaoIndicador({ rotulo: 'Inadimplência', valor: fmtMoeda(vencidas.reduce((s, p) => s + Number(p.valor || 0), 0)),
    nota: `${vencidas.length} parcela(s)`, variante: vencidas.length ? 'fatal' : 'ok' })}
      </div>
      ${contratos.length ? contratos.map((c) => `
        <section class="cartao" style="margin-bottom:.7rem">
          <div class="cartao__cabecalho">
            <div><h3>${esc(c.descricao)}</h3>
              <div class="mini mudo">${esc(nomeCliente(c.clienteId))}
              ${c.processoId ? ` · processo ${esc(processoDe(c.processoId)?.numeroCNJ || '')}` : ''}</div></div>
            <div class="linha">
              <span class="negrito">${esc(fmtMoeda(c.valorContratado))}</span>
              <button class="btn btn--pequeno" data-recibo="${c.id}">Recibo</button>
              <button class="btn btn--pequeno btn--perigo" data-excluir="${c.id}">Excluir</button>
            </div>
          </div>
          <div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
            <table class="tabela"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th>
              <th>Situação</th><th></th></tr></thead>
            <tbody>${(c.parcelas || []).map((p, i) => `<tr>
              <td>${p.n}</td><td>${esc(fmtData(p.vencimento))}</td><td>${esc(fmtMoeda(p.valor))}</td>
              <td>${p.pagoEm ? `<span class="selo selo--ok">pago em ${esc(fmtData(p.pagoEm))}</span>`
    : `<span class="selo selo--${p.vencimento < hoje() ? 'fatal' : 'neutro'}">${p.vencimento < hoje() ? 'em atraso' : 'em aberto'}</span>`}</td>
              <td>${p.pagoEm ? '' : `<button class="btn btn--pequeno" data-baixa="${c.id}:${i}">Registrar pagamento</button>`}</td>
            </tr>`).join('')}</tbody></table>
          </div>
        </section>`).join('')
    : '<div class="vazio"><span class="ico">💰</span>Nenhum contrato de honorários cadastrado.</div>'}`;
  };

  delegar(tela, 'click', '[data-baixa]', (_e, el) => {
    const [id, i] = el.dataset.baixa.split(':');
    const c = db.obter('financeiro', id);
    const parcelas = [...c.parcelas];
    parcelas[Number(i)] = { ...parcelas[Number(i)], pagoEm: hoje() };
    db.atualizar('financeiro', id, { parcelas }, 'Pagamento registrado');
    aviso('Pagamento registrado.', 'ok'); desenhar();
  });
  delegar(tela, 'click', '[data-excluir]', async (_e, el) => {
    if (!await confirmar({ titulo: 'Excluir contrato', mensagem: 'O registro poderá ser recuperado na lixeira. Confirma?', perigo: true })) return;
    db.remover('financeiro', el.dataset.excluir); desenhar();
  });
  delegar(tela, 'click', '[data-recibo]', (_e, el) => {
    const c = db.obter('financeiro', el.dataset.recibo);
    const pagas = (c.parcelas || []).filter((p) => p.pagoEm);
    const totalPago = pagas.reduce((s, p) => s + Number(p.valor || 0), 0);
    baixarArquivo(`recibo-${c.id}.txt`, [
      `RECIBO DE HONORÁRIOS ADVOCATÍCIOS`, '',
      `${db.config().escritorio.nome}`, '',
      `Recebi(emos) de ${nomeCliente(c.clienteId)} a importância de ${fmtMoeda(totalPago)},`,
      `referente a ${c.descricao}.`, '',
      `Parcelas quitadas: ${pagas.map((p) => `${p.n} (${fmtData(p.pagoEm)})`).join(', ') || 'nenhuma'}`,
      '', `${db.config().escritorio.nome}`, fmtData(hoje()),
    ].join('\n'));
  });
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioContrato(desenhar));
  desenhar();
  return tela;
}

function abrirFormularioContrato(aoConcluir) {
  modalFormulario({
    titulo: 'Contrato de honorários', largo: true,
    campos: [
      { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes(), obrigatorio: true, largura: 2 },
      { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos() },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', obrigatorio: true, largura: 2 },
      { nome: 'valorContratado', rotulo: 'Valor total', tipo: 'money', obrigatorio: true },
      { nome: 'parcelas', rotulo: 'Número de parcelas', tipo: 'number', valor: 1, obrigatorio: true },
      { nome: 'primeiroVencimento', rotulo: 'Primeiro vencimento', tipo: 'date', obrigatorio: true },
    ],
    valores: { primeiroVencimento: hoje(), parcelas: 1 },
    rotuloSalvar: 'Cadastrar',
    aoSalvar: (d) => {
      const n = Math.max(1, Number(d.parcelas) || 1);
      const valor = Number((Number(d.valorContratado) / n).toFixed(2));
      const parcelas = Array.from({ length: n }, (_, i) => ({
        n: i + 1, valor, vencimento: addMonths(d.primeiroVencimento, i), pagoEm: null,
      }));
      db.inserir('financeiro', { clienteId: d.clienteId, processoId: d.processoId || null,
        descricao: d.descricao, valorContratado: d.valorContratado, parcelas }, 'Contrato cadastrado');
      aviso('Contrato cadastrado.', 'ok');
      aoConcluir?.();
    },
  });
}
