// Audiências — aparecem automaticamente no calendário e geram alertas.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, listaEventos, opcoesProcessos, opcoesUsuarios } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { MODALIDADES_AUDIENCIA, processoDe, nomeCliente, nomeUsuario } from '../core/dominio.js';
import { fmtData, fmtCNJ, hoje, addDays } from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { historicoHTML } from './prazos.js';
import { whatsapp, MODELOS_MENSAGEM, contextoMensagem, exportarAgendaICS } from '../core/integracoes.js';

export function audiencias({ params }) {
  if (params[0]) return fichaAudiencia(params[0]);
  definirTitulo('Audiências');

  const futuras = db.listar('audiencias').filter((a) => a.data >= hoje())
    .sort((a, b) => a.data.localeCompare(b.data));
  const passadas = db.listar('audiencias').filter((a) => a.data < hoje())
    .sort((a, b) => b.data.localeCompare(a.data));

  const mapa = (a) => ({ ...a, tipoRegistro: 'audiencia', data: a.data,
    titulo: `Audiência ${a.modalidade || ''}`.trim(), rota: `#/audiencias/${a.id}` });

  const tela = h(`<div>
    ${cabecalhoPagina('Audiências', `
      <button class="btn btn--primario" data-acao="nova">Nova audiência</button>
      <button class="btn" data-acao="ics">Exportar para calendário</button>`)}
    <div class="cartao" style="margin-bottom:.8rem">
      <div class="cartao__cabecalho"><h3>Próximas</h3></div>
      <div class="cartao__corpo cartao__corpo--liso">${listaEventos(futuras.map(mapa), 'Nenhuma audiência futura.')}</div>
    </div>
    <div class="cartao">
      <div class="cartao__cabecalho"><h3>Realizadas</h3></div>
      <div class="cartao__corpo cartao__corpo--liso">${listaEventos(passadas.map(mapa), 'Nenhum registro anterior.')}</div>
    </div>
  </div>`);

  delegar(tela, 'click', '[data-acao="nova"]', () => abrirFormularioAudiencia({}, () => recarregar()));
  delegar(tela, 'click', '[data-acao="ics"]', () => {
    exportarAgendaICS(futuras.map(mapa), 'audiencias.ics');
    aviso('Arquivo .ics gerado. A agenda do sistema segue sendo a fonte principal.', 'ok');
  });
  delegar(tela, 'click', '.lista__item[data-rota]', (_e, el) => ir(el.dataset.rota));
  return tela;
}

function fichaAudiencia(id) {
  const a = db.obter('audiencias', id);
  if (!a) return '<div class="aviso aviso--alerta">Audiência não encontrada.</div>';
  const proc = processoDe(a.processoId);
  definirTitulo(`Audiência ${fmtData(a.data)}`);

  const tela = h(`<div>
    ${cabecalhoPagina(`Audiência — ${fmtData(a.data)} ${a.hora || ''}`, `
      <button class="btn btn--primario" data-acao="avisar">Avisar cliente</button>
      <button class="btn" data-acao="editar">Editar</button>
      <button class="btn btn--perigo" data-acao="excluir">Excluir</button>`)}
    <div class="cartao"><div class="cartao__corpo">
      <dl class="chave-valor">
        <dt>Data</dt><dd class="negrito">${esc(fmtData(a.data))} ${esc(a.hora || '')}</dd>
        <dt>Modalidade</dt><dd>${esc(a.modalidade || '—')}</dd>
        <dt>Local</dt><dd>${esc(a.endereco || '—')}</dd>
        <dt>Link</dt><dd>${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">acessar sala virtual</a>` : '—'}</dd>
        <dt>Processo</dt><dd>${proc ? `<a href="#/processos/${proc.id}" class="mono">${esc(fmtCNJ(proc.numeroCNJ))}</a>` : '—'}</dd>
        <dt>Cliente</dt><dd>${a.clienteId ? `<a href="#/clientes/${a.clienteId}">${esc(nomeCliente(a.clienteId))}</a>` : '—'}</dd>
        <dt>Responsável</dt><dd>${esc(nomeUsuario(a.responsavelId))}</dd>
        <dt>Status</dt><dd>${esc(a.status || 'pendente')}</dd>
      </dl>
      ${a.observacoes ? `<div class="quebra mini" style="margin-top:.7rem">${esc(a.observacoes)}</div>` : ''}
    </div></div>
    <div class="cartao" style="margin-top:.7rem"><div class="cartao__corpo">
      <h3>Histórico</h3>${historicoHTML('audiencias', id)}</div></div>
  </div>`);

  delegar(tela, 'click', '[data-acao="editar"]', () => abrirFormularioAudiencia(a, () => recarregar()));
  delegar(tela, 'click', '[data-acao="avisar"]', async () => {
    try {
      const ctx = contextoMensagem({ clienteId: a.clienteId, processoId: a.processoId, audiencia: a });
      await whatsapp.enviar({ clienteId: a.clienteId, processoId: a.processoId,
        mensagem: MODELOS_MENSAGEM.audiencia(ctx) });
      aviso('Mensagem preparada e registrada no histórico.', 'ok');
    } catch (e) { aviso(e.message, 'erro'); }
  });
  delegar(tela, 'click', '[data-acao="excluir"]', async () => {
    if (!await confirmar({ titulo: 'Excluir audiência', mensagem: 'Confirma a exclusão? O registro poderá ser recuperado na lixeira.', perigo: true })) return;
    db.remover('audiencias', id); ir('audiencias');
  });
  return tela;
}

const CAMPOS = () => [
  { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos(), obrigatorio: true, largura: 2 },
  { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true },
  { nome: 'hora', rotulo: 'Horário', tipo: 'time' },
  { nome: 'modalidade', rotulo: 'Modalidade', tipo: 'select', opcoes: MODALIDADES_AUDIENCIA },
  { nome: 'responsavelId', rotulo: 'Responsável', tipo: 'select', opcoes: opcoesUsuarios(), obrigatorio: true },
  { nome: 'endereco', rotulo: 'Endereço', tipo: 'text', largura: 2 },
  { nome: 'link', rotulo: 'Link da sala virtual', tipo: 'text', largura: 2 },
  { nome: 'status', rotulo: 'Status', tipo: 'select', vazio: false,
    opcoes: [{ valor: 'pendente', rotulo: 'Designada' }, { valor: 'realizada', rotulo: 'Realizada' },
      { valor: 'cancelada', rotulo: 'Cancelada' }] },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largura: 3 },
];

export function abrirFormularioAudiencia(valores = {}, aoConcluir) {
  const campos = CAMPOS();
  const edicao = Boolean(valores.id);
  modalFormulario({
    titulo: edicao ? 'Editar audiência' : 'Nova audiência', campos, largo: true,
    valores: { status: 'pendente', modalidade: 'Presencial', data: addDays(hoje(), 7), ...valores },
    rotuloSalvar: edicao ? 'Salvar' : 'Cadastrar audiência',
    aoSalvar: (dados) => {
      const registro = { ...dados, clienteId: processoDe(dados.processoId)?.clienteId || null };
      if (edicao) db.atualizar('audiencias', valores.id, registro, 'Audiência alterada');
      else db.inserir('audiencias', registro, 'Audiência cadastrada');
      aviso('Audiência salva e incluída no calendário.', 'ok');
      aoConcluir?.();
    },
  });
}
