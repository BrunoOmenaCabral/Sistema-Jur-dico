// Clientes: cadastro, panorama consolidado e relatório em linguagem acessível.

import { h, qs, esc, delegar, aviso, confirmar, modal } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, listaEventos } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { panoramaCliente, nomeUsuario, processoDe } from '../core/dominio.js';
import { relatorioCliente } from '../core/ia.js';
import { whatsapp, email, baixarArquivo } from '../core/integracoes.js';
import {
  fmtCNJ, fmtData, fmtDocumento, fmtTelefone, fmtDataHora, norm, fmtMoeda,
} from '../core/util.js';
import { ir, recarregar } from '../ui/roteador.js';
import { definirTitulo } from '../ui/casca.js';
import { historicoHTML } from './prazos.js';

export function clientes({ params }) {
  if (params[0]) return fichaCliente(params[0]);
  definirTitulo('Clientes');
  let busca = '';

  const tela = h(`<div>
    ${cabecalhoPagina('Clientes', '<button class="btn btn--primario" data-acao="novo">Novo cliente</button>')}
    <div class="filtros"><input data-busca type="search" placeholder="Nome, CPF/CNPJ, e-mail…"></div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    let lista = db.listar('clientes');
    if (busca) {
      const q = norm(busca), d = busca.replace(/\D/g, '');
      lista = lista.filter((c) => norm(`${c.nome} ${c.email}`).includes(q)
        || (d && String(c.documento || '').replace(/\D/g, '').includes(d)));
    }
    qs('#lista', tela).innerHTML = lista.length ? `<table class="tabela">
      <thead><tr><th>Cliente</th><th>Documento</th><th>Contato</th><th>Processos</th><th>Prazos abertos</th></tr></thead>
      <tbody>${lista.map((c) => {
      const procs = db.listar('processos', { clienteId: c.id });
      const ativos = procs.filter((p) => p.status === 'ativo').length;
      const prazos = db.listar('prazos').filter((p) => procs.some((x) => x.id === p.processoId)
        && ['pendente', 'andamento'].includes(p.status)).length;
      return `<tr data-id="${c.id}">
        <td>${esc(c.nome)}<div class="mini mudo">${esc(c.tipoPessoa === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física')}</div></td>
        <td>${esc(fmtDocumento(c.documento))}</td>
        <td>${esc(fmtTelefone(c.telefone))}<div class="mini mudo">${esc(c.email || '')}</div></td>
        <td>${ativos} ativo(s)<div class="mini mudo">${procs.length} no total</div></td>
        <td>${prazos ? `<span class="selo selo--proximo">${prazos}</span>` : '—'}</td>
      </tr>`;
    }).join('')}</tbody></table>` : '<div class="vazio"><span class="ico">👤</span>Nenhum cliente.</div>';
  };

  delegar(tela, 'input', '[data-busca]', (_e, el) => { busca = el.value; desenhar(); });
  delegar(tela, 'click', 'tbody tr', (_e, el) => ir(`clientes/${el.dataset.id}`));
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioCliente({}, desenhar));
  desenhar();
  return tela;
}

/* ----------------------------------------------------------------- ficha */

function fichaCliente(id) {
  const v = panoramaCliente(id);
  if (!v.cliente) return '<div class="aviso aviso--alerta">Cliente não encontrado.</div>';
  const c = v.cliente;
  definirTitulo(c.nome);

  const tela = h(`<div>
    ${cabecalhoPagina(c.nome, `
      <button class="btn btn--primario" data-acao="relatorio">Relatório do cliente</button>
      <button class="btn" data-acao="whatsapp">WhatsApp</button>
      <button class="btn" data-acao="editar">Editar</button>`,
    `${c.tipoPessoa === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'} · ${fmtDocumento(c.documento)}`)}

    <div class="grade grade--indicadores" style="margin-bottom:.8rem">
      <div class="indicador"><div class="indicador__rotulo">Processos ativos</div>
        <div class="indicador__valor">${v.ativos.length}</div></div>
      <div class="indicador"><div class="indicador__rotulo">Encerrados</div>
        <div class="indicador__valor">${v.encerrados.length}</div></div>
      <div class="indicador ${v.prazos.length ? 'indicador--proximo' : ''}">
        <div class="indicador__rotulo">Prazos próximos</div>
        <div class="indicador__valor">${v.prazos.length}</div></div>
      <div class="indicador indicador--audiencia"><div class="indicador__rotulo">Audiências</div>
        <div class="indicador__valor">${v.audiencias.length}</div></div>
    </div>

    <div class="grade grade--2" style="margin-bottom:.8rem">
      <section class="cartao"><div class="cartao__corpo">
        <h3>Contato</h3>
        <dl class="chave-valor" style="margin-top:.5rem">
          <dt>E-mail</dt><dd>${esc(c.email || '—')}</dd>
          <dt>Telefone</dt><dd>${esc(fmtTelefone(c.telefone))}</dd>
          <dt>WhatsApp</dt><dd>${esc(fmtTelefone(c.whatsapp))}</dd>
          <dt>Endereço</dt><dd>${esc([c.endereco, c.cidade, c.uf].filter(Boolean).join(', ') || '—')}</dd>
          <dt>Tipo</dt><dd>${esc(c.tipoCliente || '—')}</dd>
        </dl>
        ${c.observacoes ? `<div class="mini quebra" style="margin-top:.6rem">${esc(c.observacoes)}</div>` : ''}
      </div></section>
      <section class="cartao"><div class="cartao__corpo">
        <h3>Últimas comunicações</h3>
        ${v.comunicacoes.length ? `<ul class="lista" style="margin-top:.4rem">${v.comunicacoes.slice(0, 5).map((m) => `
          <li class="lista__item"><div class="lista__corpo">
            <div class="lista__titulo">${esc(m.canal)} — ${esc(fmtDataHora(m.enviadoEm))}</div>
            <div class="lista__meta quebra">${esc(String(m.mensagem).slice(0, 140))}</div></div></li>`).join('')}</ul>`
    : '<div class="mini mudo" style="margin-top:.4rem">Nenhuma comunicação registrada.</div>'}
      </div></section>
    </div>

    <div class="abas">
      <div class="aba ativa" data-aba="processos">Processos (${v.processos.length})</div>
      <div class="aba" data-aba="prazos">Prazos (${v.prazos.length})</div>
      <div class="aba" data-aba="documentos">Documentos (${v.documentos.length})</div>
      <div class="aba" data-aba="financeiro">Financeiro</div>
      <div class="aba" data-aba="historico">Auditoria</div>
    </div>
    <div class="cartao"><div class="cartao__corpo" id="painel"></div></div>
  </div>`);

  const paineis = {
    processos: () => v.processos.length ? `<ul class="lista">${v.processos.map((p) => `
      <li class="lista__item" data-rota="#/processos/${p.id}">
        <span class="lista__faixa" style="background:var(--c-audiencia)"></span>
        <div class="lista__corpo"><div class="lista__titulo mono">${esc(fmtCNJ(p.numeroCNJ))}</div>
        <div class="lista__meta"><span>${esc(p.assunto || p.classe || '')}</span>
        <span>${esc(p.vara || '')}</span><span>resp. ${esc(nomeUsuario(p.responsavelId))}</span></div></div>
        <div class="lista__lado"><span class="selo selo--${p.status === 'ativo' ? 'ok' : 'neutro'}">${esc(p.status)}</span></div>
      </li>`).join('')}</ul>` : '<div class="vazio">Nenhum processo.</div>',

    prazos: () => listaEventos(v.prazos.map((p) => ({ ...p, tipoRegistro: 'prazo', data: p.dataVencimento,
      titulo: p.tipoRotulo, rota: `#/prazos/${p.id}` })), 'Nenhum prazo em aberto.'),

    documentos: () => v.documentos.length ? `<ul class="lista">${v.documentos.map((d) => `
      <li class="lista__item"><div class="lista__corpo"><div class="lista__titulo">${esc(d.nome)}</div>
      <div class="lista__meta">${esc(d.categoria)} · ${esc(fmtData(d.criadoEm))}</div></div></li>`).join('')}</ul>`
      : '<div class="vazio">Nenhum documento.</div>',

    financeiro: () => v.financeiro.length ? v.financeiro.map((f) => `
      <div style="margin-bottom:.8rem"><div class="negrito">${esc(f.descricao)} — ${esc(fmtMoeda(f.valorContratado))}</div>
      <table class="tabela"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead>
      <tbody>${(f.parcelas || []).map((p) => `<tr><td>${p.n}</td><td>${esc(fmtData(p.vencimento))}</td>
        <td>${esc(fmtMoeda(p.valor))}</td>
        <td>${p.pagoEm ? `<span class="selo selo--ok">pago em ${esc(fmtData(p.pagoEm))}</span>`
    : `<span class="selo selo--${p.vencimento < new Date().toISOString().slice(0, 10) ? 'fatal' : 'neutro'}">em aberto</span>`}</td></tr>`).join('')}
      </tbody></table></div>`).join('') : '<div class="vazio">Nenhum contrato de honorários.</div>',

    historico: () => historicoHTML('clientes', id),
  };

  const mostrar = (aba) => { qs('#painel', tela).innerHTML = paineis[aba](); };
  mostrar('processos');

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    mostrar(el.dataset.aba);
  });
  delegar(tela, 'click', '[data-rota]', (_e, el) => el.dataset.rota && ir(el.dataset.rota));
  delegar(tela, 'click', '[data-acao="editar"]', () => abrirFormularioCliente(c, () => recarregar()));
  delegar(tela, 'click', '[data-acao="relatorio"]', () => abrirRelatorioCliente(id));
  delegar(tela, 'click', '[data-acao="whatsapp"]', () => abrirEnvioLivre(id));
  return tela;
}

/* ------------------------------------------------------------ relatório -- */

export function abrirRelatorioCliente(clienteId) {
  const r = relatorioCliente(clienteId);
  if (!r) { aviso('Cliente não encontrado.', 'erro'); return; }

  modal({
    titulo: 'Relatório do cliente', largo: true,
    conteudo: `<div class="aviso aviso--info">Texto gerado a partir dos dados cadastrados,
        em linguagem destinada ao cliente. Revise antes de enviar.</div>
      <textarea id="texto-relatorio" style="width:100%;min-height:380px;font-family:var(--f-mono);font-size:.82rem">${esc(r.texto)}</textarea>`,
    acoes: [
      { rotulo: 'Baixar', aoClicar: (_f, corpo) => {
        baixarArquivo(`relatorio-${norm(r.cliente.nome).replace(/\s+/g, '-')}.txt`,
          qs('#texto-relatorio', corpo).value);
      } },
      { rotulo: 'Imprimir / PDF', aoClicar: (_f, corpo) => imprimirTexto(r.cliente.nome, qs('#texto-relatorio', corpo).value) },
      { rotulo: 'Enviar por e-mail', aoClicar: async (_f, corpo) => {
        try {
          await email.enviar({ clienteId, assunto: `Relatório processual — ${r.cliente.nome}`,
            mensagem: qs('#texto-relatorio', corpo).value });
          aviso('E-mail preparado e registrado.', 'ok');
        } catch (e) { aviso(e.message, 'erro'); }
      } },
      { rotulo: 'Enviar por WhatsApp', classe: 'btn--primario', aoClicar: async (_f, corpo) => {
        try {
          await whatsapp.enviar({ clienteId, mensagem: qs('#texto-relatorio', corpo).value });
          aviso('Mensagem preparada e registrada.', 'ok');
        } catch (e) { aviso(e.message, 'erro'); }
      } },
    ],
  });
}

function imprimirTexto(titulo, texto) {
  const janela = window.open('', '_blank');
  janela.document.write(`<html><head><title>${esc(titulo)}</title>
    <style>body{font:13px/1.6 system-ui;margin:2.5cm 2cm;white-space:pre-wrap}</style></head>
    <body>${esc(texto)}</body></html>`);
  janela.document.close();
  janela.print();
}

function abrirEnvioLivre(clienteId) {
  modalFormulario({
    titulo: 'Mensagem ao cliente',
    campos: [{ nome: 'mensagem', rotulo: 'Mensagem', tipo: 'textarea', obrigatorio: true, largura: 3 }],
    rotuloSalvar: 'Enviar pelo WhatsApp',
    aoSalvar: async ({ mensagem }) => {
      try { await whatsapp.enviar({ clienteId, mensagem }); aviso('Mensagem registrada.', 'ok'); }
      catch (e) { aviso(e.message, 'erro'); return false; }
    },
  });
}

/* -------------------------------------------------------------- cadastro */

const CAMPOS = [
  { nome: 'nome', rotulo: 'Nome / Razão social', tipo: 'text', obrigatorio: true, largura: 2 },
  { nome: 'tipoPessoa', rotulo: 'Tipo', tipo: 'select', vazio: false,
    opcoes: [{ valor: 'PF', rotulo: 'Pessoa física' }, { valor: 'PJ', rotulo: 'Pessoa jurídica' }] },
  { nome: 'documento', rotulo: 'CPF / CNPJ', tipo: 'text' },
  { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel' },
  { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'tel' },
  { nome: 'endereco', rotulo: 'Endereço', tipo: 'text', largura: 2 },
  { nome: 'cidade', rotulo: 'Cidade', tipo: 'text' },
  { nome: 'uf', rotulo: 'UF', tipo: 'text' },
  { nome: 'tipoCliente', rotulo: 'Classificação', tipo: 'text', ajuda: 'Ex.: avulso, contrato mensal.' },
  { nome: 'ativo', rotulo: 'Cliente ativo', tipo: 'checkbox' },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', largura: 3 },
];

export function abrirFormularioCliente(valores = {}, aoConcluir) {
  const edicao = Boolean(valores.id);
  modalFormulario({
    titulo: edicao ? 'Editar cliente' : 'Novo cliente', campos: CAMPOS, largo: true,
    valores: { tipoPessoa: 'PF', ativo: true, ...valores },
    rotuloSalvar: edicao ? 'Salvar' : 'Cadastrar cliente',
    aoSalvar: (dados, ctx) => {
      const doc = String(dados.documento || '').replace(/\D/g, '');
      const duplicado = db.listar('clientes').find((c) => c.id !== valores.id
        && String(c.documento || '').replace(/\D/g, '') === doc && doc);
      if (duplicado) {
        ctx.avisos.innerHTML = `<div class="aviso aviso--atencao">⚠️ Já existe cliente com este documento: ${esc(duplicado.nome)}.</div>`;
        if (!ctx.form.dataset.confirmado) { ctx.form.dataset.confirmado = '1'; return false; }
      }
      if (edicao) db.atualizar('clientes', valores.id, dados, 'Cliente alterado');
      else db.inserir('clientes', dados, 'Cliente cadastrado');
      aviso('Cliente salvo.', 'ok');
      aoConcluir?.();
    },
  });
}
