// Documentos vinculados a processo e cliente, organizados por categoria/pasta.
//
// Nesta versão os arquivos são guardados no próprio navegador (base64), com
// limite conservador de tamanho. O ponto de troca para armazenamento em nuvem
// é a função `guardarArquivo`.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, opcoesProcessos, opcoesClientes } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { CATEGORIAS_DOCUMENTO, processoDe, nomeCliente } from '../core/dominio.js';
import { fmtData, fmtCNJ, norm } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';
import { baixarArquivo } from '../core/integracoes.js';

const LIMITE_BYTES = 2 * 1024 * 1024;
const tamanho = (b) => (!b ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

let filtro = { categoria: '', busca: '' };

export function documentos() {
  definirTitulo('Documentos');
  const tela = h(`<div>
    ${cabecalhoPagina('Documentos', '<button class="btn btn--primario" data-acao="novo">Anexar documento</button>')}
    <div class="filtros">
      <select data-filtro="categoria"><option value="">Todas as categorias</option>
        ${CATEGORIAS_DOCUMENTO.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      <input data-filtro="busca" type="search" placeholder="Nome, pasta, processo…">
    </div>
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem" id="lista"></div></div>
  </div>`);

  const desenhar = () => {
    let lista = db.listar('documentos');
    if (filtro.categoria) lista = lista.filter((d) => d.categoria === filtro.categoria);
    if (filtro.busca) {
      const q = norm(filtro.busca);
      lista = lista.filter((d) => norm(`${d.nome} ${d.pasta} ${d.categoria} ${nomeCliente(d.clienteId)}`).includes(q));
    }
    qs('#lista', tela).innerHTML = lista.length ? `<table class="tabela">
      <thead><tr><th>Documento</th><th>Categoria</th><th>Processo</th><th>Cliente</th>
      <th>Tamanho</th><th>Data</th><th></th></tr></thead>
      <tbody>${lista.map((d) => {
      const p = processoDe(d.processoId);
      return `<tr>
        <td>${esc(d.nome)}<div class="mini mudo">${esc(d.pasta || '')}</div></td>
        <td><span class="selo">${esc(d.categoria)}</span></td>
        <td class="mono">${p ? esc(fmtCNJ(p.numeroCNJ)) : '—'}</td>
        <td>${esc(nomeCliente(d.clienteId))}</td>
        <td>${esc(tamanho(d.tamanho))}</td>
        <td>${esc(fmtData(d.criadoEm))}</td>
        <td class="linha">
          ${d.conteudoArquivo ? `<button class="btn btn--pequeno" data-baixar="${d.id}">Baixar</button>` : ''}
          <button class="btn btn--pequeno btn--perigo" data-excluir="${d.id}">Excluir</button></td>
      </tr>`;
    }).join('')}</tbody></table>`
      : '<div class="vazio"><span class="ico">📄</span>Nenhum documento.</div>';
  };

  delegar(tela, 'change', '[data-filtro]', (_e, el) => { filtro[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'input', 'input[data-filtro]', (_e, el) => { filtro[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioDocumento({}, desenhar));
  delegar(tela, 'click', '[data-baixar]', (_e, el) => {
    const d = db.obter('documentos', el.dataset.baixar);
    fetch(d.conteudoArquivo).then((r) => r.blob()).then((b) => baixarArquivo(d.nome, b));
  });
  delegar(tela, 'click', '[data-excluir]', async (_e, el) => {
    if (!await confirmar({ titulo: 'Excluir documento',
      mensagem: 'O documento sai da listagem, mas permanece recuperável na lixeira. Confirma?', perigo: true })) return;
    db.remover('documentos', el.dataset.excluir); desenhar();
  });
  desenhar();
  return tela;
}

const CAMPOS = () => [
  { nome: 'nome', rotulo: 'Nome do documento', tipo: 'text', obrigatorio: true, largura: 2 },
  { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: CATEGORIAS_DOCUMENTO, obrigatorio: true },
  { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos(), largura: 2 },
  { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes() },
  { nome: 'pasta', rotulo: 'Pasta', tipo: 'text', largura: 2, ajuda: 'Organização livre. Ex.: Petições, Provas.' },
];

export function abrirFormularioDocumento(valores = {}, aoConcluir) {
  const campos = CAMPOS();
  const seletor = h(`<div class="campo" style="margin-top:.7rem">
    <label>Arquivo</label><input type="file" data-arquivo>
    <span class="campo__ajuda">Até 2 MB nesta versão local. Integração com nuvem prevista na arquitetura.</span>
  </div>`);
  let arquivo = null;

  seletor.querySelector('[data-arquivo]').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    if (f.size > LIMITE_BYTES) { aviso('Arquivo acima de 2 MB. Selecione outro.', 'erro'); ev.target.value = ''; return; }
    arquivo = f;
  });

  const ref = modalFormulario({
    titulo: 'Anexar documento', campos, valores, largo: true, rotuloSalvar: 'Anexar',
    extras: seletor,
    aoSalvar: async (dados) => {
      const registro = { ...dados, clienteId: dados.clienteId || processoDe(dados.processoId)?.clienteId || null };
      if (arquivo) {
        registro.tamanho = arquivo.size;
        registro.tipo = arquivo.type;
        registro.conteudoArquivo = await guardarArquivo(arquivo);
      }
      db.inserir('documentos', registro, 'Documento anexado');
      aviso('Documento anexado.', 'ok');
      aoConcluir?.();
    },
  });

  // Preenche o nome do documento a partir do arquivo escolhido.
  seletor.querySelector('[data-arquivo]').addEventListener('change', () => {
    if (arquivo && !ref.form.elements.nome.value) ref.form.elements.nome.value = arquivo.name;
  });
  return ref;
}

/** Ponto de extensão para armazenamento externo (Drive, OneDrive, S3). */
function guardarArquivo(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}
