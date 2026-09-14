// Tarefas internas do escritório — providências que não são prazo processual.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, listaEventos, opcoesProcessos, opcoesUsuarios, opcoesClientes } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { PRIORIDADES, STATUS_PRAZO, processoDe, nomeCliente, nomeUsuario } from '../core/dominio.js';
import { fmtData, fmtCNJ, hoje } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { historicoHTML } from './prazos.js';

const MODELOS = ['Solicitar documentos ao cliente', 'Preparar procuração', 'Conferir cálculo',
  'Elaborar contestação', 'Protocolar petição', 'Entrar em contato com cliente'];

let filtro = { status: 'abertas', responsavelId: '' };

export function tarefas({ params }) {
  if (params[0]) return fichaTarefa(params[0]);
  definirTitulo('Tarefas');

  const tela = h(`<div>
    ${cabecalhoPagina('Tarefas', '<button class="btn btn--primario" data-acao="nova">Nova tarefa</button>')}
    <div class="filtros">
      <select data-filtro="status">
        <option value="abertas">Em aberto</option>
        <option value="concluido">Concluídas</option>
        <option value="">Todas</option>
      </select>
      <select data-filtro="responsavelId"><option value="">Todos os responsáveis</option>
        ${opcoesUsuarios().map((u) => `<option value="${u.valor}">${esc(u.rotulo)}</option>`).join('')}</select>
    </div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    let lista = db.listar('tarefas');
    if (filtro.status === 'abertas') lista = lista.filter((t) => ['pendente', 'andamento'].includes(t.status));
    else if (filtro.status) lista = lista.filter((t) => t.status === filtro.status);
    if (filtro.responsavelId) lista = lista.filter((t) => t.responsavelId === filtro.responsavelId);
    lista.sort((a, b) => String(a.dataVencimento || '9').localeCompare(String(b.dataVencimento || '9')));
    qs('#lista', tela).innerHTML = listaEventos(lista.map((t) => ({
      ...t, tipoRegistro: 'tarefa', data: t.dataVencimento, titulo: t.titulo, rota: `#/tarefas/${t.id}`,
    })), 'Nenhuma tarefa.');
  };

  delegar(tela, 'change', '[data-filtro]', (_e, el) => { filtro[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'click', '[data-acao="nova"]', () => abrirFormularioTarefa({}, desenhar));
  delegar(tela, 'click', '.lista__item[data-rota]', (_e, el) => ir(el.dataset.rota));
  qs('[data-filtro="status"]', tela).value = filtro.status;
  desenhar();
  return tela;
}

function fichaTarefa(id) {
  const t = db.obter('tarefas', id);
  if (!t) return '<div class="aviso aviso--alerta">Tarefa não encontrada.</div>';
  definirTitulo(t.titulo);
  const proc = processoDe(t.processoId);

  const tela = h(`<div>
    ${cabecalhoPagina(t.titulo, `
      ${t.status !== 'concluido' ? '<button class="btn btn--primario" data-acao="concluir">Concluir</button>' : ''}
      <button class="btn" data-acao="editar">Editar</button>
      <button class="btn btn--perigo" data-acao="excluir">Excluir</button>`)}
    <div class="cartao"><div class="cartao__corpo">
      <dl class="chave-valor">
        <dt>Prazo</dt><dd>${esc(fmtData(t.dataVencimento))}</dd>
        <dt>Prioridade</dt><dd>${esc(PRIORIDADES.find((p) => p.id === t.prioridade)?.rotulo || 'Normal')}</dd>
        <dt>Status</dt><dd>${esc(STATUS_PRAZO.find((s) => s.id === t.status)?.rotulo || t.status)}</dd>
        <dt>Responsável</dt><dd>${esc(nomeUsuario(t.responsavelId))}</dd>
        <dt>Processo</dt><dd>${proc ? `<a href="#/processos/${proc.id}" class="mono">${esc(fmtCNJ(proc.numeroCNJ))}</a>` : '—'}</dd>
        <dt>Cliente</dt><dd>${t.clienteId ? `<a href="#/clientes/${t.clienteId}">${esc(nomeCliente(t.clienteId))}</a>` : '—'}</dd>
      </dl>
      ${t.observacao ? `<div class="quebra mini" style="margin-top:.7rem">${esc(t.observacao)}</div>` : ''}
    </div></div>
    <div class="cartao" style="margin-top:.7rem"><div class="cartao__corpo">
      <h3>Histórico</h3>${historicoHTML('tarefas', id)}</div></div>
  </div>`);

  delegar(tela, 'click', '[data-acao="concluir"]', () => {
    db.atualizar('tarefas', id, { status: 'concluido', concluidoEm: new Date().toISOString() }, 'Tarefa concluída');
    aviso('Tarefa concluída.', 'ok'); recarregar();
  });
  delegar(tela, 'click', '[data-acao="editar"]', () => abrirFormularioTarefa(t, () => recarregar()));
  delegar(tela, 'click', '[data-acao="excluir"]', async () => {
    if (!await confirmar({ titulo: 'Excluir tarefa', mensagem: 'A tarefa poderá ser recuperada na lixeira. Confirma?', perigo: true })) return;
    db.remover('tarefas', id); ir('tarefas');
  });
  return tela;
}

const CAMPOS = () => [
  { nome: 'titulo', rotulo: 'Tarefa', tipo: 'text', obrigatorio: true, largura: 2,
    ajuda: `Sugestões: ${MODELOS.join(' · ')}` },
  { nome: 'dataVencimento', rotulo: 'Prazo', tipo: 'date' },
  { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos(), largura: 2 },
  { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes() },
  { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', opcoes: opcoesUsuarios(), obrigatorio: true },
  { nome: 'prioridade', rotulo: 'Prioridade', tipo: 'select', vazio: false,
    opcoes: PRIORIDADES.map((p) => ({ valor: p.id, rotulo: p.rotulo })) },
  { nome: 'status', rotulo: 'Status', tipo: 'select', vazio: false,
    opcoes: STATUS_PRAZO.map((s) => ({ valor: s.id, rotulo: s.rotulo })) },
  { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', largura: 3 },
];

export function abrirFormularioTarefa(valores = {}, aoConcluir) {
  const campos = CAMPOS();
  const edicao = Boolean(valores.id);
  modalFormulario({
    titulo: edicao ? 'Editar tarefa' : 'Nova tarefa', campos, largo: true,
    valores: { prioridade: 'normal', status: 'pendente', dataVencimento: hoje(), ...valores },
    rotuloSalvar: edicao ? 'Salvar' : 'Criar tarefa',
    aoSalvar: (dados) => {
      const registro = { ...dados, clienteId: dados.clienteId || processoDe(dados.processoId)?.clienteId || null };
      if (edicao) db.atualizar('tarefas', valores.id, registro, 'Tarefa alterada');
      else db.inserir('tarefas', registro, 'Tarefa criada');
      aviso('Tarefa salva.', 'ok'); aoConcluir?.();
    },
  });
}
