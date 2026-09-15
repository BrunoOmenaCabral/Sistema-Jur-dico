// Processos: cadastro com o número CNJ como identificador único e ficha
// completa com resumo, linha do tempo e todos os vínculos.

import { h, qs, esc, delegar, aviso, confirmar, modal } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, opcoesClientes, opcoesUsuarios, listaEventos,
  atalhoDeCadastro } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { pode } from '../core/auth.js';
import {
  processoPorNumero, linhaDoTempo, nomeCliente, nomeUsuario, enriquecerPrazo,
  FASES_PROCESSO, STATUS_PROCESSO, situacaoPrazo,
  dependenciasDoProcesso, arquivarProcesso, reativarProcesso, excluirProcesso,
} from '../core/dominio.js';
import { fmtCNJ, validarCNJ, cnjDigitos, fmtData, fmtMoeda, norm, hoje } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { abrirFormularioPrazo, historicoHTML } from './prazos.js';
import { abrirFormularioTarefa } from './tarefas.js';
import { abrirFormularioAudiencia } from './audiencias.js';
import { abrirFormularioDocumento } from './documentos.js';
import { abrirConsultaProcessual } from './primeiro-acesso.js';
import { abrirFormularioCliente } from './clientes.js';
import { atualizarPeloTribunal } from '../core/integracoes.js';
import { INDICES, indiceDoProcesso } from '../core/datajud.js';

let filtroProc = { status: 'ativo', busca: '', responsavelId: '' };

export function processos({ params }) {
  if (params[0]) return fichaProcesso(params[0]);
  definirTitulo('Processos');

  const tela = h(`<div>
    ${cabecalhoPagina('Processos', pode('processos:criar')
    ? `<button class="btn" data-acao="consultar">Buscar pela OAB</button>
       <button class="btn btn--primario" data-acao="novo">Novo processo</button>` : '')}
    <div class="filtros">
      <select data-filtro="status">
        <option value="ativo">Ativos</option>
        <option value="">Todos</option>
        ${STATUS_PROCESSO.filter((s) => s !== 'ativo').map((s) => `<option value="${s}">${esc(s)}</option>`).join('')}
      </select>
      <select data-filtro="responsavelId"><option value="">Todos os responsáveis</option>
        ${opcoesUsuarios().map((u) => `<option value="${u.valor}">${esc(u.rotulo)}</option>`).join('')}</select>
      <input data-filtro="busca" type="search" placeholder="Número, cliente, parte, vara, assunto…">
    </div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    let lista = db.listar('processos');
    if (filtroProc.status) lista = lista.filter((p) => p.status === filtroProc.status);
    if (filtroProc.responsavelId) lista = lista.filter((p) => p.responsavelId === filtroProc.responsavelId);
    if (filtroProc.busca) {
      const q = norm(filtroProc.busca), d = filtroProc.busca.replace(/\D/g, '');
      lista = lista.filter((p) => norm(`${p.assunto} ${p.poloAtivo} ${p.poloPassivo} ${p.vara} ${p.tribunal} ${nomeCliente(p.clienteId)}`).includes(q)
        || (d && cnjDigitos(p.numeroCNJ).includes(d)));
    }
    qs('#lista', tela).innerHTML = lista.length ? `<table class="tabela">
      <thead><tr><th>Número</th><th>Cliente</th><th>Parte contrária</th><th>Vara/Tribunal</th>
      <th>Fase</th><th>Prazos</th><th>Status</th><th></th></tr></thead>
      <tbody>${lista.map((p) => {
      const abertos = db.listar('prazos', { processoId: p.id })
        .filter((x) => ['pendente', 'andamento'].includes(x.status));
      const critico = abertos.some((x) => x.dataVencimento <= hoje());
      return `<tr data-id="${p.id}">
          <td class="mono">${esc(fmtCNJ(p.numeroCNJ))}</td>
          <td>${esc(nomeCliente(p.clienteId))}</td>
          <td>${esc(p.poloPassivo || '—')}</td>
          <td>${esc(p.vara || '—')}<div class="mini mudo">${esc(p.tribunal || '')}</div></td>
          <td>${esc(p.fase || '—')}</td>
          <td>${abertos.length ? `<span class="selo ${critico ? 'selo--fatal' : 'selo--proximo'}">${abertos.length}</span>` : '—'}</td>
          <td><span class="selo selo--${p.status === 'ativo' ? 'ok' : 'neutro'}">${esc(p.status)}</span></td>
          <td class="linha" data-sem-navegacao>
            ${['arquivado', 'encerrado'].includes(p.status)
    ? `<button class="btn btn--pequeno" data-reativar="${p.id}">Reabrir</button>`
    : (pode('processos:editar')
      ? `<button class="btn btn--pequeno" data-arquivar="${p.id}">Arquivar</button>` : '')}
            ${pode('processos:excluir')
    ? `<button class="btn btn--pequeno btn--perigo" data-excluir="${p.id}">Excluir</button>` : ''}
          </td>
        </tr>`;
    }).join('')}</tbody></table>`
      : '<div class="vazio"><span class="ico">📁</span>Nenhum processo encontrado.</div>';
  };

  delegar(tela, 'change', '[data-filtro]', (_e, el) => { filtroProc[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'input', 'input[data-filtro]', (_e, el) => { filtroProc[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'click', 'tbody tr', (ev, el) => {
    if (ev.target.closest('[data-sem-navegacao]')) return;
    ir(`processos/${el.dataset.id}`);
  });
  delegar(tela, 'click', '[data-arquivar]', (_ev, el) => {
    abrirArquivamento(db.obter('processos', el.dataset.arquivar), desenhar);
  });
  delegar(tela, 'click', '[data-excluir]', (_ev, el) => {
    abrirExclusao(db.obter('processos', el.dataset.excluir), desenhar);
  });
  delegar(tela, 'click', '[data-reativar]', async (_ev, el) => {
    const ok = await confirmar({ titulo: 'Reabrir processo',
      mensagem: 'O processo volta à situação ativa. Os prazos cancelados no arquivamento não '
        + 'são restaurados automaticamente. Confirma?', rotuloOk: 'Reabrir' });
    if (!ok) return;
    reativarProcesso(el.dataset.reativar);
    aviso('Processo reaberto.', 'ok');
    desenhar();
  });
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioProcesso({}, desenhar));
  delegar(tela, 'click', '[data-acao="consultar"]', () => abrirConsultaProcessual(desenhar));
  qs('[data-filtro="status"]', tela).value = filtroProc.status;
  desenhar();
  return tela;
}

/* ----------------------------------------------------------------- ficha */

export function fichaProcesso(id) {
  const p = db.obter('processos', id);
  if (!p) return '<div class="aviso aviso--alerta">Processo não encontrado.</div>';
  definirTitulo(fmtCNJ(p.numeroCNJ));

  const prazos = db.listar('prazos', { processoId: id }).map(enriquecerPrazo);
  const tarefas = db.listar('tarefas', { processoId: id });
  const audiencias = db.listar('audiencias', { processoId: id });
  const documentos = db.listar('documentos', { processoId: id });
  const publicacoes = db.listar('publicacoes', { processoId: id });
  const timeline = linhaDoTempo(id);

  const tela = h(`<div>
    ${cabecalhoPagina(fmtCNJ(p.numeroCNJ), `
      <button class="btn btn--primario" data-acao="prazo">Novo prazo</button>
      <button class="btn" data-acao="tarefa">Nova tarefa</button>
      <button class="btn" data-acao="audiencia">Nova audiência</button>
      <button class="btn" data-acao="documento">Anexar documento</button>
      <button class="btn" data-acao="tribunal">Atualizar pelo tribunal</button>
      <button class="btn" data-acao="movimentacao">Registrar movimentação</button>
      <button class="btn" data-acao="editar">Editar</button>
      ${['arquivado', 'encerrado'].includes(p.status)
    ? '<button class="btn" data-acao="reativar">Reabrir</button>'
    : (pode('processos:editar') ? '<button class="btn" data-acao="arquivar">Arquivar</button>' : '')}
      ${pode('processos:excluir') ? '<button class="btn btn--perigo" data-acao="excluir">Excluir</button>' : ''}`,
    `${p.classe || ''} · ${p.assunto || ''}`, { voltar: 'processos' })}

    <div class="grade grade--2" style="margin-bottom:.8rem">
      <section class="cartao"><div class="cartao__corpo">
        <h3>Resumo</h3>
        <dl class="chave-valor" style="margin-top:.5rem">
          <dt>Cliente</dt><dd><a href="#/clientes/${p.clienteId}">${esc(nomeCliente(p.clienteId))}</a></dd>
          <dt>Polo ativo</dt><dd>${esc(p.poloAtivo || '—')}</dd>
          <dt>Polo passivo</dt><dd>${esc(p.poloPassivo || '—')}</dd>
          <dt>Vara</dt><dd>${esc(p.vara || '—')}</dd>
          <dt>Comarca</dt><dd>${esc(p.comarca || '—')}${p.uf ? ` / ${esc(p.uf)}` : ''}</dd>
          <dt>Tribunal</dt><dd>${esc(p.tribunal || '—')}</dd>
          <dt>Responsável</dt><dd>${esc(nomeUsuario(p.responsavelId))}</dd>
          <dt>Status</dt><dd><span class="selo selo--${p.status === 'ativo' ? 'ok' : 'neutro'}">${esc(p.status)}</span></dd>
        </dl>
      </div></section>
      <section class="cartao"><div class="cartao__corpo">
        <h3>Dados processuais</h3>
        <dl class="chave-valor" style="margin-top:.5rem">
          <dt>Classe</dt><dd>${esc(p.classe || '—')}</dd>
          <dt>Assunto</dt><dd>${esc(p.assunto || '—')}</dd>
          <dt>Fase</dt><dd>${esc(p.fase || '—')}</dd>
          <dt>Distribuição</dt><dd>${esc(fmtData(p.dataDistribuicao))}</dd>
          <dt>Valor da causa</dt><dd>${esc(fmtMoeda(p.valorCausa))}</dd>
          <dt>Adv. adverso</dt><dd>${esc(p.advogadoAdverso || '—')}</dd>
          <dt>Contagem</dt><dd>${p.regimePrazo === 'corridos' ? 'dias corridos' : 'dias úteis'}</dd>
        </dl>
        ${p.observacoes ? `<div class="mini quebra" style="margin-top:.6rem">${esc(p.observacoes)}</div>` : ''}
      </div></section>
    </div>

    <div class="abas">
      <div class="aba ativa" data-aba="timeline">Linha do tempo</div>
      <div class="aba" data-aba="prazos">Prazos (${prazos.length})</div>
      <div class="aba" data-aba="audiencias">Audiências (${audiencias.length})</div>
      <div class="aba" data-aba="tarefas">Tarefas (${tarefas.length})</div>
      <div class="aba" data-aba="publicacoes">Publicações (${publicacoes.length})</div>
      <div class="aba" data-aba="documentos">Documentos (${documentos.length})</div>
      <div class="aba" data-aba="historico">Auditoria</div>
    </div>
    <div class="cartao"><div class="cartao__corpo" id="painel"></div></div>
  </div>`);

  const paineis = {
    timeline: () => timeline.length ? `<ul class="timeline">${timeline.map((t) => `
      <li data-tipo="${esc(t.tipo)}">
        <div class="linha linha--entre">
          <div class="timeline__data">${esc(fmtData(t.data))}
            ${t.origem ? `<span class="selo selo--neutro">${esc(t.origem)}</span>` : ''}</div>
          ${t.editavel ? `<span class="linha">
            <button class="btn btn--pequeno" data-editar-mov="${esc(t.registroId)}">Editar</button>
            <button class="btn btn--pequeno btn--perigo" data-excluir-mov="${esc(t.registroId)}">Excluir</button>
          </span>` : ''}
        </div>
        <div class="timeline__titulo" ${t.rota ? `data-rota="${esc(t.rota)}" style="cursor:pointer"` : ''}>${esc(t.titulo)}
          ${t.teor ? '<span class="selo selo--publicacao">teor disponível</span>' : ''}</div>
        ${t.detalhe ? `<div class="timeline__detalhe quebra">${esc(String(t.detalhe).slice(0, 400))}</div>` : ''}
        ${t.teor ? `<details class="teor">
          <summary class="mini">Ler o teor do ato</summary>
          <div class="teor__corpo quebra">${esc(t.teor)}</div>
          <div class="mini mudo">${esc(t.fonteTeor || '')}
            ${t.linkTeor ? `· <a href="${esc(t.linkTeor)}" target="_blank" rel="noopener">inteiro teor no CNJ</a>` : ''}</div>
        </details>` : ''}
      </li>`).join('')}</ul>` : '<div class="vazio">Sem registros na linha do tempo.</div>',

    prazos: () => listaEventos(prazos.map((x) => ({ ...x, tipoRegistro: 'prazo', data: x.dataVencimento,
      titulo: `${x.tipoRotulo}${x.descricao ? ` — ${x.descricao}` : ''}`, rota: `#/prazos/${x.id}` })),
    'Nenhum prazo cadastrado.'),

    audiencias: () => listaEventos(audiencias.map((a) => ({ ...a, tipoRegistro: 'audiencia', data: a.data,
      titulo: `Audiência ${a.modalidade || ''}`, rota: `#/audiencias/${a.id}` })), 'Nenhuma audiência.'),

    tarefas: () => listaEventos(tarefas.map((t) => ({ ...t, tipoRegistro: 'tarefa', data: t.dataVencimento,
      titulo: t.titulo, rota: `#/tarefas/${t.id}` })), 'Nenhuma tarefa.'),

    publicacoes: () => publicacoes.length ? `<ul class="lista">${publicacoes.map((x) => `
      <li class="lista__item" data-rota="#/publicacoes/${x.id}">
        <span class="lista__faixa" style="background:var(--c-publicacao)"></span>
        <div class="lista__corpo"><div class="lista__titulo">${esc(fmtData(x.dataPublicacao))} — ${esc(x.diario || '')}</div>
        <div class="lista__meta quebra">${esc(String(x.conteudo).slice(0, 200))}…</div></div>
        <div class="lista__lado"><span class="selo selo--${x.status === 'pendente' ? 'proximo' : 'ok'}">${esc(x.status)}</span></div>
      </li>`).join('')}</ul>` : '<div class="vazio">Nenhuma publicação vinculada.</div>',

    documentos: () => documentos.length ? `<ul class="lista">${documentos.map((d) => `
      <li class="lista__item"><span class="lista__faixa" style="background:var(--c-normal)"></span>
        <div class="lista__corpo"><div class="lista__titulo">${esc(d.nome)}</div>
        <div class="lista__meta"><span>${esc(d.categoria)}</span><span>${esc(fmtData(d.criadoEm))}</span></div></div>
      </li>`).join('')}</ul>` : '<div class="vazio">Nenhum documento anexado.</div>',

    historico: () => historicoHTML('processos', id),
  };

  const mostrar = (aba) => { qs('#painel', tela).innerHTML = paineis[aba](); };
  mostrar('timeline');

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    mostrar(el.dataset.aba);
  });
  delegar(tela, 'click', '[data-rota]', (_e, el) => el.dataset.rota && ir(el.dataset.rota));
  delegar(tela, 'click', '[data-acao="prazo"]', () => abrirFormularioPrazo({ processoId: id }, () => recarregar()));
  delegar(tela, 'click', '[data-acao="tarefa"]', () => abrirFormularioTarefa({ processoId: id, clienteId: p.clienteId }, () => recarregar()));
  delegar(tela, 'click', '[data-acao="audiencia"]', () => abrirFormularioAudiencia({ processoId: id, clienteId: p.clienteId }, () => recarregar()));
  delegar(tela, 'click', '[data-acao="documento"]', () => abrirFormularioDocumento({ processoId: id, clienteId: p.clienteId }, () => recarregar()));
  delegar(tela, 'click', '[data-acao="editar"]', () => abrirFormularioProcesso(p, () => recarregar()));
  delegar(tela, 'click', '[data-acao="tribunal"]', () => abrirAtualizacaoPeloTribunal(p, () => recarregar()));
  delegar(tela, 'click', '[data-acao="arquivar"]', () => abrirArquivamento(p, () => recarregar()));
  delegar(tela, 'click', '[data-acao="reativar"]', async () => {
    const ok = await confirmar({
      titulo: 'Reabrir processo',
      mensagem: 'O processo volta à situação ativa e reaparece nas listagens. Os prazos '
        + 'cancelados no arquivamento não são restaurados automaticamente. Confirma?',
      rotuloOk: 'Reabrir',
    });
    if (!ok) return;
    reativarProcesso(id);
    aviso('Processo reaberto.', 'ok');
    recarregar();
  });
  delegar(tela, 'click', '[data-acao="excluir"]', () => abrirExclusao(p, () => ir('processos')));
  delegar(tela, 'click', '[data-acao="movimentacao"]', () =>
    abrirFormularioMovimentacao({ processoId: id }, () => recarregar()));
  delegar(tela, 'click', '[data-editar-mov]', (_e, el) =>
    abrirFormularioMovimentacao(db.obter('movimentacoes', el.dataset.editarMov), () => recarregar()));
  delegar(tela, 'click', '[data-excluir-mov]', async (_e, el) => {
    const ok = await confirmar({
      titulo: 'Excluir movimentação',
      mensagem: 'O registro sai da linha do tempo, mas permanece recuperável na lixeira. Confirma?',
      rotuloOk: 'Excluir', perigo: true,
    });
    if (!ok) return;
    db.remover('movimentacoes', el.dataset.excluirMov, 'Movimentação excluída na linha do tempo');
    aviso('Movimentação excluída.', 'atencao');
    recarregar();
  });
  return tela;
}

/* ------------------------------------------- movimentações da linha do tempo */

/**
 * Inclusão e correção manual da linha do tempo.
 *
 * O que chega do DJEN e do andamento processual é preservado. Este cadastro
 * existe para o que o tribunal não publica, para o que veio incompleto e para
 * o registro interno do escritório. A origem fica marcada em cada item, de
 * modo que a leitura distinga o capturado do lançado à mão.
 */
export function abrirFormularioMovimentacao(valores = {}, aoConcluir) {
  const edicao = Boolean(valores.id);
  const campos = [
    { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true },
    { nome: 'origem', rotulo: 'Origem', tipo: 'select', vazio: false, largura: 2,
      opcoes: [
        { valor: 'manual', rotulo: 'Registro interno do escritório' },
        { valor: 'andamento processual', rotulo: 'Andamento processual do tribunal' },
        { valor: 'DJEN', rotulo: 'Diário de Justiça Eletrônico Nacional' },
      ] },
    { nome: 'titulo', rotulo: 'Movimentação', tipo: 'text', obrigatorio: true, largura: 3,
      ajuda: 'Ex.: Decisão publicada, Juntada de petição, Conclusos para sentença.' },
    { nome: 'teor', rotulo: 'Teor', tipo: 'textarea', largura: 3,
      ajuda: 'Texto do despacho ou da decisão. É a partir dele que o sistema descreve a novidade ao cliente.' },
  ];

  return modalFormulario({
    titulo: edicao ? 'Editar movimentação' : 'Registrar movimentação',
    campos, largo: true,
    valores: { data: hoje(), origem: 'manual', ...valores },
    rotuloSalvar: edicao ? 'Salvar alterações' : 'Registrar',
    aoSalvar: (dados) => {
      if (edicao) db.atualizar('movimentacoes', valores.id, dados, 'Movimentação alterada');
      else db.inserir('movimentacoes', dados, 'Movimentação registrada');
      aviso(edicao ? 'Movimentação atualizada.' : 'Movimentação incluída na linha do tempo.', 'ok');
      aoConcluir?.();
    },
  });
}

/* -------------------------------------------------------------- cadastro */

const CAMPOS = () => [
  { nome: 'numeroCNJ', rotulo: 'Número CNJ', tipo: 'text', obrigatorio: true, largura: 2,
    ajuda: 'Identificador único do processo. O sistema valida o dígito verificador e impede duplicidade.' },
  { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes(), obrigatorio: true },
  { nome: 'tribunal', rotulo: 'Tribunal', tipo: 'text', ajuda: 'Ex.: TJPE, TRF5, TRT6.' },
  { nome: 'comarca', rotulo: 'Comarca', tipo: 'text' },
  { nome: 'uf', rotulo: 'UF', tipo: 'text', ajuda: 'Define os feriados estaduais aplicáveis.' },
  { nome: 'vara', rotulo: 'Vara', tipo: 'text', largura: 2 },
  { nome: 'classe', rotulo: 'Classe processual', tipo: 'text' },
  { nome: 'assunto', rotulo: 'Assunto', tipo: 'text', largura: 2 },
  { nome: 'fase', rotulo: 'Fase', tipo: 'select', opcoes: FASES_PROCESSO },
  { nome: 'poloAtivo', rotulo: 'Polo ativo', tipo: 'text', largura: 2 },
  { nome: 'poloPassivo', rotulo: 'Polo passivo', tipo: 'text', largura: 2 },
  { nome: 'advogadoAdverso', rotulo: 'Advogado adverso', tipo: 'text', largura: 2 },
  { nome: 'responsavelId', rotulo: 'Advogado responsável', tipo: 'select', opcoes: opcoesUsuarios(), obrigatorio: true },
  { nome: 'valorCausa', rotulo: 'Valor da causa', tipo: 'money' },
  { nome: 'dataDistribuicao', rotulo: 'Distribuição', tipo: 'date' },
  { nome: 'status', rotulo: 'Status', tipo: 'select', vazio: false, opcoes: STATUS_PROCESSO },
  { nome: 'regimePrazo', rotulo: 'Contagem padrão', tipo: 'select', vazio: false,
    opcoes: [{ valor: 'uteis', rotulo: 'Dias úteis' }, { valor: 'corridos', rotulo: 'Dias corridos' }] },
  { nome: 'observacoes', rotulo: 'Observações internas', tipo: 'textarea', largura: 3 },
];

export function abrirFormularioProcesso(valores = {}, aoConcluir) {
  const campos = CAMPOS();
  const edicao = Boolean(valores.id);
  let confirmadoDV = false;

  const ref = modalFormulario({
    titulo: edicao ? 'Editar processo' : 'Novo processo',
    campos, largo: true,
    valores: { status: 'ativo', regimePrazo: 'uteis', ...valores },
    rotuloSalvar: edicao ? 'Salvar alterações' : 'Cadastrar processo',
    aoSalvar: (dados, ctx) => {
      const numero = cnjDigitos(dados.numeroCNJ);
      const duplicado = processoPorNumero(numero, valores.id || null);
      if (duplicado) {
        ctx.avisos.innerHTML = `<div class="aviso aviso--alerta">⚠️ Já existe processo cadastrado com este
          número: ${esc(fmtCNJ(duplicado.numeroCNJ))} — ${esc(nomeCliente(duplicado.clienteId))}.
          O número CNJ é identificador único e não admite duplicidade.</div>`;
        return false;
      }
      const v = validarCNJ(numero);
      if (!v.valido && !confirmadoDV) {
        confirmadoDV = true;
        ctx.avisos.innerHTML = `<div class="aviso aviso--atencao">⚠️ ${esc(v.motivo)}
          Confira o número digitado. Para cadastrar mesmo assim, clique novamente em salvar.</div>`;
        return false;
      }
      const registro = { ...dados, numeroCNJ: numero, uf: (dados.uf || '').toUpperCase() };
      if (edicao) db.atualizar('processos', valores.id, registro, 'Processo alterado');
      else db.inserir('processos', registro, 'Processo cadastrado');
      aviso(edicao ? 'Processo atualizado.' : 'Processo cadastrado.', 'ok');
      aoConcluir?.();
      return true;
    },
  });

  // O cliente pode não estar cadastrado ainda. Em vez de obrigar a sair do
  // processo pela metade, o cadastro abre aqui e já volta escolhido.
  atalhoDeCadastro(ref.form, 'clienteId', {
    rotulo: '+ Cadastrar cliente',
    abrir: (aoCriar) => abrirFormularioCliente({}, aoCriar),
  });

  return ref;
}

/* ----------------------------------------- arquivamento e exclusão ------- */

const ROTULOS_VINCULO = {
  prazos: 'prazo', tarefas: 'tarefa', audiencias: 'audiência', publicacoes: 'publicação',
  documentos: 'documento', comunicacoes: 'comunicação', financeiro: 'lançamento financeiro',
  movimentacoes: 'movimentação',
};

/** Descreve em palavras o que está pendurado no processo. */
function descreverVinculos(contagem) {
  return Object.entries(contagem)
    .map(([colecao, n]) => `${n} ${ROTULOS_VINCULO[colecao] || colecao}${n > 1 ? 's' : ''}`)
    .join(', ');
}

/**
 * Arquivamento do processo encerrado.
 *
 * O histórico permanece inteiro. Os prazos ainda em aberto são cancelados,
 * porque prazo de processo arquivado seguiria disparando alerta sem ter o que
 * cobrar, e o sistema existe justamente para que alerta signifique alguma coisa.
 */
export function abrirArquivamento(processo, aoConcluir) {
  const { prazosAbertos, audienciasFuturas } = dependenciasDoProcesso(processo.id);

  const alerta = [];
  if (prazosAbertos) {
    alerta.push(`<div class="aviso aviso--atencao">${prazosAbertos} prazo(s) em aberto neste
      processo serão cancelados no arquivamento.</div>`);
  }
  if (audienciasFuturas) {
    alerta.push(`<div class="aviso aviso--atencao">Há ${audienciasFuturas} audiência(s) ainda
      por realizar. Confirme se o processo está mesmo encerrado.</div>`);
  }

  modalFormulario({
    titulo: 'Arquivar processo',
    largo: true,
    campos: [
      { nome: 'status', rotulo: 'Situação', tipo: 'select', vazio: false,
        opcoes: [
          { valor: 'arquivado', rotulo: 'Arquivado' },
          { valor: 'encerrado', rotulo: 'Encerrado' },
          { valor: 'suspenso', rotulo: 'Suspenso' },
        ] },
      { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, largura: 2 },
      { nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea', largura: 3,
        ajuda: 'Ex.: sentença transitada em julgado, acordo cumprido, desistência homologada.' },
    ],
    valores: { status: 'arquivado', data: hoje() },
    rotuloSalvar: 'Arquivar',
    extras: alerta.join('') || undefined,
    aoSalvar: ({ status, data, motivo }) => {
      const r = arquivarProcesso(processo.id, { status, data, motivo });
      aviso(`Processo ${status}.`
        + (r.prazosCancelados ? ` ${r.prazosCancelados} prazo(s) cancelado(s).` : ''), 'ok');
      aoConcluir?.();
    },
  });
}

/**
 * Exclusão do cadastro equivocado.
 *
 * Só se justifica quando o processo não deveria existir. Para o que terminou,
 * o caminho é arquivar. A exclusão é lógica e leva os vínculos junto, para não
 * deixar prazo apontando para processo inexistente, e tudo permanece
 * recuperável na lixeira, em Configurações.
 */
export async function abrirExclusao(processo, aoConcluir) {
  const { contagem, total, prazosAbertos } = dependenciasDoProcesso(processo.id);

  const partes = [`Excluir o processo ${fmtCNJ(processo.numeroCNJ)}?`];
  if (total) partes.push(`Saem junto: ${descreverVinculos(contagem)}.`);
  if (prazosAbertos) {
    partes.push(`Atenção: ${prazosAbertos} prazo(s) em aberto. `
      + 'Se o processo apenas terminou, o caminho é arquivar, não excluir.');
  }
  partes.push('A exclusão é lógica: tudo permanece recuperável na lixeira, em Configurações.');

  const ok = await confirmar({
    titulo: 'Excluir processo',
    mensagem: partes.join(' '),
    rotuloOk: 'Sim, excluir',
    perigo: true,
  });
  if (!ok) return;

  const r = excluirProcesso(processo.id, 'Exclusão solicitada na tela de processos');
  aviso(`Processo excluído${r.total ? ` com ${r.total} registro(s) vinculado(s)` : ''}. `
    + 'Recuperável na lixeira.', 'atencao');
  aoConcluir?.();
}

/* ------------------------------------- movimentos vindos do tribunal ----- */

/**
 * Traz o andamento que o tribunal já registrou.
 *
 * O processo cadastrado à mão entra sem histórico, e é este o caminho para
 * reconstituí-lo. A fonte é o DataJud, base pública do CNJ alimentada por cada
 * tribunal a partir do próprio sistema, distinta do diário de intimações.
 */
export function abrirAtualizacaoPeloTribunal(processo, aoConcluir) {
  const sugerido = indiceDoProcesso(processo);

  const corpo = h(`<div class="pilha">
    <p class="quebra">A consulta busca a capa e todos os movimentos que o tribunal publicou
      para o processo <span class="mono">${esc(fmtCNJ(processo.numeroCNJ))}</span> e os
      acrescenta à linha do tempo. Movimento já importado não entra de novo, e o que você
      lançou à mão permanece como está.</p>

    <div class="campo"><label for="dj-indice">Tribunal</label>
      <select id="dj-indice">
        ${INDICES.map((i) => `<option value="${i}" ${i === sugerido ? 'selected' : ''}>${i.toUpperCase()}</option>`).join('')}
      </select>
      <span class="campo__ajuda">${sugerido
    ? 'Deduzido do número do processo. Altere se o processo tramitar em outro tribunal.'
    : 'Não foi possível deduzir do número. Escolha o tribunal.'}</span></div>

    <div id="dj-resultado"></div>
  </div>`);

  const ref = modal({
    titulo: 'Atualizar pelo tribunal', conteudo: corpo, largo: true,
    acoes: [
      { rotulo: 'Fechar', aoClicar: (fechar) => fechar() },
      { rotulo: 'Consultar', classe: 'btn--primario', aoClicar: async (_fechar, _corpo, botao) => {
        botao.disabled = true;
        const rotulo = botao.textContent;
        botao.textContent = 'Consultando…';
        qs('#dj-resultado', corpo).innerHTML = '<div class="mini mudo">Consultando o DataJud…</div>';
        try {
          const r = await atualizarPeloTribunal(processo.id, { indice: qs('#dj-indice', corpo).value });
          if (!r.ok) {
            qs('#dj-resultado', corpo).innerHTML = `<div class="aviso aviso--atencao quebra">${esc(r.motivo)}</div>`;
            return;
          }
          qs('#dj-resultado', corpo).innerHTML = `
            <div class="aviso aviso--ok">${r.importados} movimento(s) acrescentado(s) à linha do tempo.</div>
            <div class="mini mudo">${r.total} movimento(s) no tribunal · ${r.repetidos} já constavam.</div>
            ${r.total ? `<div class="mini mudo">${r.decisorios} ato(s) decisório(s)${r.decisorios
    ? ` · ${r.comTeor} com o teor recuperado do diário oficial` : ''}.</div>` : ''}
            ${r.motivoTeor ? `<div class="aviso aviso--atencao quebra">${esc(r.motivoTeor)}</div>` : ''}
            ${r.complementados.length
    ? `<div class="mini mudo">Capa complementada: ${esc(r.complementados.join(', '))}.</div>` : ''}
            <div class="mini mudo">Classe: ${esc(r.capa.classe || '—')} · Órgão: ${esc(r.capa.vara || '—')}</div>`;
          aviso(`${r.importados} movimento(s) importado(s) do tribunal.`, 'ok');
          aoConcluir?.();
        } finally {
          botao.disabled = false;
          botao.textContent = rotulo;
        }
      } },
    ],
  });
  return ref;
}
