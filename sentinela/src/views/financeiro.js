// Módulo financeiro: honorários contratados, parcelas, recebimentos e inadimplência.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario, lerFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, cartaoIndicador, opcoesClientes, opcoesProcessos } from '../ui/componentes.js';
import { db } from '../core/store.js';
import {
  nomeCliente, processoDe, montarParcelas, somaParcelas, PERIODICIDADES,
} from '../core/dominio.js';
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
              <td>${esc(p.rotulo || `${p.n}ª parcela`)}</td><td>${esc(fmtData(p.vencimento))}</td><td>${esc(fmtMoeda(p.valor))}</td>
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
      `Parcelas quitadas: ${pagas.map((p) => `${p.rotulo || `${p.n}ª parcela`} (${fmtData(p.pagoEm)})`).join(', ') || 'nenhuma'}`,
      '', `${db.config().escritorio.nome}`, fmtData(hoje()),
    ].join('\n'));
  });
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioContrato(desenhar));
  desenhar();
  return tela;
}

/**
 * Cadastro de contrato de honorários.
 *
 * O parcelamento real de honorários raramente é regular: costuma haver entrada
 * em valor próprio e parcelas com datas negociadas. Por isso a tela monta uma
 * proposta a partir dos campos e, em seguida, deixa cada linha editável em data
 * e valor, com conferência da soma contra o valor contratado.
 */
function abrirFormularioContrato(aoConcluir) {
  const campos = [
    { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes(), obrigatorio: true, largura: 2 },
    { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos() },
    { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', obrigatorio: true, largura: 2 },
    { nome: 'valorContratado', rotulo: 'Valor total', tipo: 'money', obrigatorio: true },
    { tipo: 'separador', rotulo: 'Forma de pagamento' },
    { nome: 'entrada', rotulo: 'Entrada (R$)', tipo: 'money', ajuda: 'Deixe zerado se não houver' },
    { nome: 'dataEntrada', rotulo: 'Data da entrada', tipo: 'date' },
    { nome: 'parcelas', rotulo: 'Parcelas do saldo', tipo: 'number', obrigatorio: true, atributos: { min: 1 } },
    { nome: 'primeiroVencimento', rotulo: 'Vencimento da 1ª parcela', tipo: 'date', obrigatorio: true },
    { nome: 'periodicidade', rotulo: 'Periodicidade', tipo: 'select', vazio: false,
      opcoes: PERIODICIDADES.map((x) => ({ valor: x.id, rotulo: x.rotulo })) },
  ];
  const valores = {
    entrada: 0, dataEntrada: hoje(), parcelas: 1,
    primeiroVencimento: addMonths(hoje(), 1), periodicidade: 'mensal',
  };

  let plano = [];
  let ajustado = false;   // alguma linha foi editada à mão

  const extras = h(`<div class="cartao" style="margin-top:.9rem">
    <div class="cartao__cabecalho">
      <div><h3>Parcelamento</h3><div class="mini mudo">Data e valor de cada linha podem ser alterados.</div></div>
      <div class="linha">
        <button type="button" class="btn btn--pequeno" data-recalcular>Recalcular</button>
        <button type="button" class="btn btn--pequeno" data-add>Acrescentar parcela</button>
      </div>
    </div>
    <div class="cartao__corpo cartao__corpo--liso tabela--rolagem" data-tabela></div>
    <div class="cartao__corpo" data-resumo></div>
  </div>`);

  const totalDoFormulario = () => Number(form.elements.valorContratado?.value || 0);

  const desenharResumo = () => {
    const soma = somaParcelas(plano);
    const dif = Number((totalDoFormulario() - soma).toFixed(2));
    qs('[data-resumo]', extras).innerHTML = `<div class="linha" style="justify-content:space-between">
      <span>Soma das parcelas: <span class="negrito">${esc(fmtMoeda(soma))}</span></span>
      ${dif === 0 ? '<span class="selo selo--ok">confere com o valor contratado</span>'
    : `<span class="linha"><span class="selo selo--fatal">diferença de ${esc(fmtMoeda(Math.abs(dif)))}</span>
        <button type="button" class="btn btn--pequeno" data-ajustar>Usar ${esc(fmtMoeda(soma))} como total</button></span>`}
    </div>`;
  };

  const desenharPlano = () => {
    qs('[data-tabela]', extras).innerHTML = plano.length ? `<table class="tabela">
      <thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor (R$)</th><th></th></tr></thead>
      <tbody>${plano.map((p, i) => `<tr>
        <td>${esc(p.rotulo || `${p.n}ª parcela`)}</td>
        <td><input type="date" data-campo="vencimento" data-i="${i}" value="${esc(p.vencimento || '')}"></td>
        <td><input type="number" step="0.01" min="0" data-campo="valor" data-i="${i}" value="${Number(p.valor || 0).toFixed(2)}"></td>
        <td><button type="button" class="btn btn--pequeno btn--perigo" data-remover="${i}" title="Remover">✕</button></td>
      </tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Informe o valor e o número de parcelas.</div>';
    desenharResumo();
  };

  const recalcular = () => {
    const d = lerFormulario(form, campos);
    plano = montarParcelas({
      total: d.valorContratado, entrada: d.entrada, dataEntrada: d.dataEntrada,
      parcelas: d.parcelas, primeiroVencimento: d.primeiroVencimento, periodicidade: d.periodicidade,
    });
    ajustado = false;
    desenharPlano();
  };

  const renumerar = () => plano.forEach((p, i) => { p.n = i + 1; });

  const { form, avisos } = modalFormulario({
    titulo: 'Contrato de honorários', largo: true, campos, valores, extras,
    rotuloSalvar: 'Cadastrar',
    aoSalvar: (d) => {
      renumerar();
      const soma = somaParcelas(plano);
      if (!plano.length) {
        avisos.innerHTML = '<div class="aviso aviso--alerta">Monte ao menos uma parcela.</div>';
        return false;
      }
      if (Number((soma - Number(d.valorContratado)).toFixed(2)) !== 0) {
        avisos.innerHTML = `<div class="aviso aviso--alerta">A soma das parcelas (${esc(fmtMoeda(soma))})
          não fecha com o valor contratado (${esc(fmtMoeda(d.valorContratado))}). Ajuste as linhas ou o total.</div>`;
        return false;
      }
      db.inserir('financeiro', {
        clienteId: d.clienteId, processoId: d.processoId || null, descricao: d.descricao,
        valorContratado: d.valorContratado, entrada: d.entrada || 0,
        parcelas: plano.map((p) => ({ ...p, pagoEm: null })),
      }, 'Contrato cadastrado');
      aviso('Contrato cadastrado.', 'ok');
      aoConcluir?.();
      return true;
    },
  });

  // Enquanto ninguém mexeu nas linhas, a proposta acompanha os campos.
  form.addEventListener('input', (ev) => {
    if (ev.target.name === 'valorContratado' && ajustado) { desenharResumo(); return; }
    if (['valorContratado', 'entrada', 'dataEntrada', 'parcelas', 'primeiroVencimento', 'periodicidade']
      .includes(ev.target.name) && !ajustado) recalcular();
  });

  delegar(extras, 'input', '[data-campo]', (_e, el) => {
    const linha = plano[Number(el.dataset.i)];
    if (!linha) return;
    if (el.dataset.campo === 'valor') linha.valor = Number(el.value) || 0;
    else linha.vencimento = el.value;
    ajustado = true;
    desenharResumo();
  });
  delegar(extras, 'click', '[data-remover]', (_e, el) => {
    plano.splice(Number(el.dataset.remover), 1);
    renumerar(); ajustado = true; desenharPlano();
  });
  delegar(extras, 'click', '[data-add]', () => {
    const ultima = plano[plano.length - 1];
    plano.push({
      n: plano.length + 1, rotulo: `${plano.filter((p) => !p.entrada).length + 1}ª parcela`, entrada: false,
      vencimento: ultima ? addMonths(ultima.vencimento, 1) : addMonths(hoje(), 1), valor: 0, pagoEm: null,
    });
    ajustado = true; desenharPlano();
  });
  delegar(extras, 'click', '[data-recalcular]', () => recalcular());
  delegar(extras, 'click', '[data-ajustar]', () => {
    form.elements.valorContratado.value = somaParcelas(plano).toFixed(2);
    desenharResumo();
  });

  desenharPlano();
}
