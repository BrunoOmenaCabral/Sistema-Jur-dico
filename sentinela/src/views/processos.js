// Processos: cadastro com o número CNJ como identificador único e ficha
// completa com resumo, linha do tempo e todos os vínculos.

import { h, qs, esc, delegar, aviso, confirmar, modal } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, opcoesClientes, opcoesUsuarios, listaEventos } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { pode } from '../core/auth.js';
import {
  processoPorNumero, linhaDoTempo, nomeCliente, nomeUsuario, enriquecerPrazo,
  FASES_PROCESSO, STATUS_PROCESSO, situacaoPrazo,
} from '../core/dominio.js';
import { fmtCNJ, validarCNJ, cnjDigitos, fmtData, fmtMoeda, norm, hoje } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { abrirFormularioPrazo, historicoHTML } from './prazos.js';
import { abrirFormularioTarefa } from './tarefas.js';
import { abrirFormularioAudiencia } from './audiencias.js';
import { abrirFormularioDocumento } from './documentos.js';

let filtroProc = { status: 'ativo', busca: '', responsavelId: '' };

export function processos({ params }) {
  if (params[0]) return fichaProcesso(params[0]);
  definirTitulo('Processos');

  const tela = h(`<div>
    ${cabecalhoPagina('Processos', pode('processos:criar')
    ? '<button class="btn btn--primario" data-acao="novo">Novo processo</button>' : '')}
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
      <th>Fase</th><th>Prazos</th><th>Status</th></tr></thead>
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
        </tr>`;
    }).join('')}</tbody></table>`
      : '<div class="vazio"><span class="ico">📁</span>Nenhum processo encontrado.</div>';
  };

  delegar(tela, 'change', '[data-filtro]', (_e, el) => { filtroProc[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'input', 'input[data-filtro]', (_e, el) => { filtroProc[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'click', 'tbody tr', (_e, el) => ir(`processos/${el.dataset.id}`));
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioProcesso({}, desenhar));
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
      <button class="btn" data-acao="editar">Editar</button>`,
    `${p.classe || ''} · ${p.assunto || ''}`)}

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
      <li data-tipo="${esc(t.tipo)}" ${t.rota ? `data-rota="${esc(t.rota)}" style="cursor:pointer"` : ''}>
        <div class="timeline__data">${esc(fmtData(t.data))}</div>
        <div class="timeline__titulo">${esc(t.titulo)}</div>
        ${t.detalhe ? `<div class="timeline__detalhe quebra">${esc(String(t.detalhe).slice(0, 400))}</div>` : ''}
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
  return tela;
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

  modalFormulario({
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
}
