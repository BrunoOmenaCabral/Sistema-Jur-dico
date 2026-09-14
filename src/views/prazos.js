// Módulo de prazos — núcleo do sistema.

import { h, qs, esc, delegar, modal, confirmar, aviso } from '../ui/ui.js';
import { modalFormulario, montarFormulario, lerFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, listaEventos, opcoesProcessos, opcoesUsuarios } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { pode } from '../core/auth.js';
import {
  listarPrazos, enriquecerPrazo, conflitosDePrazo, situacaoPrazo, rotuloSituacao,
  concluirPrazo, reabrirPrazo, duplicarPrazo, PRIORIDADES, STATUS_PRAZO, processoDe,
  nomeCliente, nomeUsuario, calendarioConfigurado, linhaDoTempo,
} from '../core/dominio.js';
import { TIPOS_PRAZO, tipoPrazo, calcularPrazo } from '../core/calculo-prazo.js';
import { hoje, fmtData, fmtCNJ, fmtDataHora, addDays, humanizarPrazo } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';

/* ------------------------------------------------------------- listagem -- */

let filtros = { status: 'abertos', responsavelId: '', prioridade: '', busca: '' };

export function prazos({ params }) {
  if (params[0] === 'novo') return abrirNovoEVoltar(params[1]);
  if (params[0]) return fichaPrazo(params[0]);
  definirTitulo('Prazos');

  const tela = h(`<div>
    ${cabecalhoPagina('Prazos', pode('prazos:criar')
    ? '<button class="btn btn--primario" data-acao="novo">Novo prazo</button>' : '')}
    <div class="filtros">
      <select data-filtro="status">
        <option value="abertos">Em aberto</option>
        <option value="vencidos">Vencidos</option>
        <option value="hoje">Vencem hoje</option>
        <option value="7">Próximos 7 dias</option>
        <option value="concluido">Concluídos</option>
        <option value="todos">Todos</option>
      </select>
      <select data-filtro="responsavelId"><option value="">Todos os responsáveis</option>
        ${opcoesUsuarios().map((u) => `<option value="${u.valor}">${esc(u.rotulo)}</option>`).join('')}</select>
      <select data-filtro="prioridade"><option value="">Todas as prioridades</option>
        ${PRIORIDADES.map((p) => `<option value="${p.id}">${esc(p.rotulo)}</option>`).join('')}</select>
      <input data-filtro="busca" type="search" placeholder="Filtrar por texto…">
    </div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    let lista = listarPrazos();
    if (filtros.status === 'abertos') lista = lista.filter((p) => ['pendente', 'andamento'].includes(p.status));
    if (filtros.status === 'vencidos') lista = lista.filter((p) => situacaoPrazo(p) === 'vencido');
    if (filtros.status === 'hoje') lista = lista.filter((p) => p.dataVencimento === hoje() && p.status !== 'concluido');
    if (filtros.status === '7') lista = lista.filter((p) => p.dataVencimento >= hoje()
      && p.dataVencimento <= addDays(hoje(), 7) && ['pendente', 'andamento'].includes(p.status));
    if (filtros.status === 'concluido') lista = lista.filter((p) => p.status === 'concluido');
    if (filtros.responsavelId) lista = lista.filter((p) => p.responsavelId === filtros.responsavelId);
    if (filtros.prioridade) lista = lista.filter((p) => p.prioridade === filtros.prioridade);
    if (filtros.busca) {
      const q = filtros.busca.toLowerCase();
      lista = lista.filter((p) => `${p.descricao || ''} ${tipoPrazo(p.tipo).rotulo} ${fmtCNJ(processoDe(p.processoId)?.numeroCNJ)} ${nomeCliente(p.clienteId)}`
        .toLowerCase().includes(q));
    }
    const eventos = lista.map((p) => {
      const e = enriquecerPrazo(p);
      return { ...e, tipoRegistro: 'prazo', data: p.dataVencimento,
        titulo: `${e.tipoRotulo}${p.descricao ? ` — ${p.descricao}` : ''}`, rota: `#/prazos/${p.id}` };
    });
    qs('#lista', tela).innerHTML = listaEventos(eventos, 'Nenhum prazo com os filtros selecionados.');
  };

  delegar(tela, 'change', '[data-filtro]', (_e, el) => { filtros[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'input', 'input[data-filtro]', (_e, el) => { filtros[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioPrazo({}, desenhar));
  delegar(tela, 'click', '.lista__item[data-rota]', (_e, el) => ir(el.dataset.rota));
  qs('[data-filtro="status"]', tela).value = filtros.status;
  desenhar();
  return tela;
}

function abrirNovoEVoltar(data) {
  abrirFormularioPrazo({ dataVencimento: data || '' }, () => ir('prazos'));
  return h('<div class="vazio">Abrindo cadastro de prazo…</div>');
}

/* ----------------------------------------------------------------- ficha */

export function fichaPrazo(id) {
  const bruto = db.obter('prazos', id);
  if (!bruto) return '<div class="aviso aviso--alerta">Prazo não encontrado.</div>';
  const p = enriquecerPrazo(bruto);
  definirTitulo(`Prazo — ${p.tipoRotulo}`);
  const proc = p.processo;
  const regra = bruto.regraCalculo;
  const situacao = p.situacao;
  const variante = { vencido: 'fatal', hoje: 'fatal', critico: 'proximo', proximo: 'tarefa',
    concluido: 'ok', cancelado: 'neutro' }[situacao] || 'neutro';

  const tela = h(`<div>
    ${cabecalhoPagina(`${p.tipoRotulo}`, `
      ${['pendente', 'andamento'].includes(bruto.status)
    ? '<button class="btn btn--primario" data-acao="concluir">Concluir prazo</button>'
    : '<button class="btn" data-acao="reabrir">Reabrir</button>'}
      <button class="btn" data-acao="editar">Editar</button>
      <button class="btn" data-acao="duplicar">Duplicar</button>
      <button class="btn btn--perigo" data-acao="excluir">Excluir</button>`,
    p.descricao || '')}

    <div class="grade grade--2">
      <section class="cartao"><div class="cartao__corpo">
        <div class="linha linha--entre" style="margin-bottom:.6rem">
          <span class="selo selo--${variante}">${esc(rotuloSituacao(situacao))}</span>
          <span class="mini mudo">${esc(humanizarPrazo(bruto.dataVencimento))}</span>
        </div>
        <dl class="chave-valor">
          <dt>Vencimento</dt><dd class="negrito">${esc(fmtData(bruto.dataVencimento))}</dd>
          <dt>Início</dt><dd>${esc(fmtData(bruto.dataInicio))}</dd>
          <dt>Dias úteis restantes</dt><dd>${p.diasUteisRestantes}</dd>
          <dt>Prioridade</dt><dd>${esc(PRIORIDADES.find((x) => x.id === bruto.prioridade)?.rotulo || 'Normal')}
            ${bruto.fatal ? '<span class="selo selo--fatal">FATAL</span>' : ''}</dd>
          <dt>Status</dt><dd>${esc(STATUS_PRAZO.find((s) => s.id === bruto.status)?.rotulo || bruto.status)}</dd>
          <dt>Responsável</dt><dd>${esc(p.responsavelNome)}</dd>
          <dt>Alertas</dt><dd>${esc((bruto.alertas || db.config().alertasPadrao).map((d) => d === 0 ? 'no dia' : `${d}d`).join(' · '))}</dd>
        </dl>
      </div></section>

      <section class="cartao"><div class="cartao__corpo">
        <h3>Processo e cliente</h3>
        ${proc ? `<dl class="chave-valor" style="margin-top:.5rem">
          <dt>Processo</dt><dd><a href="#/processos/${proc.id}" class="mono">${esc(fmtCNJ(proc.numeroCNJ))}</a></dd>
          <dt>Cliente</dt><dd><a href="#/clientes/${proc.clienteId}">${esc(p.clienteNome)}</a></dd>
          <dt>Parte contrária</dt><dd>${esc(proc.poloPassivo || '—')}</dd>
          <dt>Vara</dt><dd>${esc(proc.vara || '—')}</dd>
          <dt>Tribunal</dt><dd>${esc(proc.tribunal || '—')}</dd>
        </dl>` : '<div class="mudo mini">Prazo sem processo vinculado.</div>'}
      </div></section>
    </div>

    <section class="cartao" style="margin-top:.7rem"><div class="cartao__corpo">
      <h3>Regra de contagem utilizada</h3>
      ${regra ? `<div class="aviso aviso--info" style="margin-top:.5rem">
          <div><span class="negrito">${esc(regra.resumoRegra || '')}</span>
          ${regra.fundamento ? `<div class="mini">${esc(regra.fundamento)}</div>` : ''}</div></div>
        ${(regra.passos || []).map((x) => `<div class="mini mudo">• ${esc(x)}</div>`).join('')}
        ${regra.desprezados?.length ? `<details style="margin-top:.5rem"><summary class="mini">Dias desprezados na contagem (${regra.desprezados.length})</summary>
          ${regra.desprezados.map((d) => `<div class="mini mudo">${esc(fmtData(d.data))} — ${esc(d.motivo)}</div>`).join('')}</details>` : ''}`
    : `<div class="aviso aviso--atencao">Prazo lançado manualmente. A regra de contagem não foi
        registrada — utilize a calculadora ao editar para deixar o fundamento documentado.</div>`}
    </div></section>

    ${bruto.origemPublicacaoId ? `<section class="cartao" style="margin-top:.7rem"><div class="cartao__corpo">
      <h3>Publicação de origem</h3>
      <a href="#/publicacoes/${bruto.origemPublicacaoId}" class="mini">abrir publicação que originou este prazo</a>
    </div></section>` : ''}

    ${bruto.observacoes ? `<section class="cartao" style="margin-top:.7rem"><div class="cartao__corpo">
      <h3>Observações</h3><div class="quebra mini" style="margin-top:.4rem">${esc(bruto.observacoes)}</div>
    </div></section>` : ''}

    <section class="cartao" style="margin-top:.7rem"><div class="cartao__corpo">
      <h3>Histórico</h3>
      ${historicoHTML('prazos', id)}
    </div></section>
  </div>`);

  delegar(tela, 'click', '[data-acao="editar"]', () => abrirFormularioPrazo(bruto, () => ir(`prazos/${id}`)));
  delegar(tela, 'click', '[data-acao="duplicar"]', () => {
    const novo = duplicarPrazo(id);
    aviso('Prazo duplicado. Revise as datas.', 'ok');
    abrirFormularioPrazo(novo, () => ir(`prazos/${novo.id}`));
  });
  delegar(tela, 'click', '[data-acao="reabrir"]', () => { reabrirPrazo(id); recarregar(); });
  delegar(tela, 'click', '[data-acao="concluir"]', () => {
    modalFormulario({
      titulo: 'Concluir prazo',
      campos: [{ nome: 'observacao', rotulo: 'Providência adotada', tipo: 'textarea',
        ajuda: 'Registrado no histórico do processo.' }],
      rotuloSalvar: 'Concluir',
      aoSalvar: ({ observacao }) => {
        concluirPrazo(id, observacao);
        aviso('Prazo concluído.', 'ok');
        recarregar();
      },
    });
  });
  delegar(tela, 'click', '[data-acao="excluir"]', async () => {
    const ok = await confirmar({
      titulo: 'Excluir prazo',
      mensagem: 'A exclusão é lógica: o prazo sai da agenda, mas permanece recuperável na '
        + 'lixeira, em Configurações. Confirma a exclusão?',
      rotuloOk: 'Excluir', perigo: true,
    });
    if (!ok) return;
    db.remover('prazos', id, 'Exclusão solicitada pelo usuário');
    aviso('Prazo excluído.', 'atencao');
    ir('prazos');
  });
  return tela;
}

export function historicoHTML(colecao, id) {
  const eventos = db.listar('auditoria', { incluirExcluidos: true })
    .filter((a) => a.colecao === colecao && a.registroId === id);
  if (!eventos.length) return '<div class="mini mudo">Sem registros.</div>';
  return `<ul class="timeline" style="margin-top:.5rem">${eventos.map((a) => `
    <li><div class="timeline__data">${esc(fmtDataHora(a.quando))}</div>
      <div class="timeline__titulo">${esc(a.usuarioNome)} ${esc(a.acao)}</div>
      ${a.detalhe ? `<div class="timeline__detalhe">${esc(a.detalhe)}</div>` : ''}</li>`).join('')}</ul>`;
}

/* -------------------------------------------------------------- cadastro */

const CAMPOS = () => [
  { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos(),
    obrigatorio: true, largura: 2, ajuda: 'O cliente é preenchido a partir do processo.' },
  { nome: 'tipo', rotulo: 'Tipo de prazo', tipo: 'select', obrigatorio: true, vazio: false,
    opcoes: TIPOS_PRAZO.map((t) => ({ valor: t.id, rotulo: t.rotulo })) },
  { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', largura: 2,
    ajuda: 'Ex.: manifestação sobre documentos juntados.' },
  { nome: 'dataInicio', rotulo: 'Início da contagem', tipo: 'date' },
  { nome: 'dataVencimento', rotulo: 'Vencimento', tipo: 'date', obrigatorio: true },
  { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', vazio: false,
    opcoes: PRIORIDADES.map((p) => ({ valor: p.id, rotulo: p.rotulo })) },
  { nome: 'status', rotulo: 'Status', tipo: 'select', vazio: false,
    opcoes: STATUS_PRAZO.map((s) => ({ valor: s.id, rotulo: s.rotulo })) },
  { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', opcoes: opcoesUsuarios(), obrigatorio: true },
  { nome: 'fatal', rotulo: 'Prazo fatal (sem prorrogação possível)', tipo: 'checkbox', largura: 2 },
  { nome: 'alertasTexto', rotulo: 'Alertas (dias de antecedência)', tipo: 'text',
    ajuda: 'Separados por vírgula. 0 = no dia do vencimento.' },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largura: 3 },
];

/**
 * Abre o cadastro/edição de prazo com calculadora acoplada e verificação de
 * conflitos. O sistema alerta e exige confirmação; nunca sobrescreve em silêncio.
 */
export function abrirFormularioPrazo(valores = {}, aoConcluir) {
  const campos = CAMPOS();
  const edicao = Boolean(valores.id);
  const iniciais = {
    prioridade: 'normal', status: 'pendente', dataInicio: hoje(),
    alertasTexto: (valores.alertas || db.config().alertasPadrao).join(', '),
    ...valores,
  };
  let regraCalculo = valores.regraCalculo || null;
  let confirmado = false;

  const calculadora = h(`<div class="cartao" style="margin-top:.9rem">
    <div class="cartao__cabecalho"><h3>Calculadora de prazo</h3>
      <span class="mini mudo">art. 224 do CPC</span></div>
    <div class="cartao__corpo">
      <div class="form__linha form__linha--3">
        <div class="campo"><label>Disponibilização no diário</label><input type="date" name="cDisp"></div>
        <div class="campo"><label>Data da publicação</label><input type="date" name="cPub"></div>
        <div class="campo"><label>Dias do prazo</label><input type="number" name="cDias" min="1" value="15"></div>
      </div>
      <div class="form__linha form__linha--3">
        <div class="campo"><label>Contagem</label>
          <select name="cContagem"><option value="uteis">Dias úteis (art. 219 do CPC)</option>
          <option value="corridos">Dias corridos</option></select></div>
        <div class="campo"><label>Multiplicador</label>
          <select name="cMult"><option value="1">Prazo simples</option>
          <option value="2">Prazo em dobro (arts. 183, 186 e 229 do CPC)</option></select></div>
        <div class="campo"><label>&nbsp;</label>
          <button type="button" class="btn btn--primario" data-calcular>Calcular vencimento</button></div>
      </div>
      <div data-resultado></div>
    </div>
  </div>`);

  const ref = modalFormulario({
    titulo: edicao ? 'Editar prazo' : 'Novo prazo',
    campos, valores: iniciais, largo: true,
    rotuloSalvar: edicao ? 'Salvar alterações' : 'Cadastrar prazo',
    extras: calculadora,
    aoSalvar: (dados, ctx) => {
      const processo = processoDe(dados.processoId);
      const registro = {
        ...dados,
        clienteId: processo?.clienteId || null,
        alertas: String(dados.alertasTexto || '').split(',').map((x) => Number(x.trim()))
          .filter((x) => Number.isFinite(x)),
        regraCalculo,
      };
      delete registro.alertasTexto;

      const conflitos = conflitosDePrazo(registro, valores.id || null);
      const graves = conflitos.filter((c) => c.nivel !== 'info');
      if (graves.length && !confirmado) {
        confirmado = true;
        ctx.avisos.innerHTML = conflitos.map((c) => `<div class="aviso aviso--${c.nivel}">⚠️ ${esc(c.texto)}</div>`)
          .join('') + '<div class="aviso aviso--info">Revise as informações. '
          + 'Para prosseguir mesmo assim, clique novamente em salvar.</div>';
        return false;
      }
      if (edicao) db.atualizar('prazos', valores.id, registro, 'Prazo alterado');
      else db.inserir('prazos', registro, 'Prazo cadastrado');
      aviso(edicao ? 'Prazo atualizado.' : 'Prazo cadastrado e incluído na agenda.', 'ok');
      aoConcluir?.();
      return true;
    },
  });

  // Preenche o cliente e sugere o tipo padrão ao escolher o processo.
  const form = ref.form;
  form.elements.tipo?.addEventListener('change', () => {
    const t = tipoPrazo(form.elements.tipo.value);
    if (t.dias) calculadora.querySelector('[name="cDias"]').value = t.dias;
    calculadora.querySelector('[name="cContagem"]').value = t.contagem;
  });

  calculadora.querySelector('[data-calcular]').addEventListener('click', () => {
    const processo = processoDe(form.elements.processoId.value);
    const r = calcularPrazo({
      dataDisponibilizacao: calculadora.querySelector('[name="cDisp"]').value || null,
      dataPublicacao: calculadora.querySelector('[name="cPub"]').value || null,
      dias: Number(calculadora.querySelector('[name="cDias"]').value),
      contagem: calculadora.querySelector('[name="cContagem"]').value,
      multiplicador: Number(calculadora.querySelector('[name="cMult"]').value),
      contexto: { uf: processo?.uf, municipio: processo?.comarca, tribunal: processo?.tribunal },
      calendario: calendarioConfigurado(),
    });
    const area = calculadora.querySelector('[data-resultado]');
    if (r.erro) { area.innerHTML = `<div class="aviso aviso--alerta">${esc(r.erro)}</div>`; return; }

    regraCalculo = {
      resumoRegra: r.resumoRegra, fundamento: r.fundamento, passos: r.passos,
      desprezados: r.desprezados, inicio: r.inicio, vencimento: r.vencimento,
      dias: r.dias, contagem: r.contagem, dataPublicacao: r.dataPublicacao,
      calculadoEm: new Date().toISOString(),
    };
    form.elements.dataInicio.value = r.inicio;
    form.elements.dataVencimento.value = r.vencimento;
    area.innerHTML = `<div class="aviso aviso--ok">
        <div><span class="negrito">Vencimento em ${esc(fmtData(r.vencimento))}</span>
        <div class="mini">Início da contagem: ${esc(fmtData(r.inicio))} · ${esc(r.resumoRegra)}</div></div></div>
      ${r.passos.map((p) => `<div class="mini mudo">• ${esc(p)}</div>`).join('')}
      ${r.suspensoes.length ? `<div class="aviso aviso--atencao" style="margin-top:.4rem">Período de suspensão considerado: ${esc(r.suspensoes.join('; '))}</div>` : ''}`;
  });

  return ref;
}
