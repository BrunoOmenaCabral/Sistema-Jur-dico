// Documentos vinculados a processo e cliente, organizados por categoria/pasta.
//
// Nesta versão os arquivos são guardados no próprio navegador (base64), com
// limite conservador de tamanho. O ponto de troca para armazenamento em nuvem
// é a função `guardarArquivo`.

import { h, qs, esc, delegar, aviso, confirmar, modal } from '../ui/ui.js';
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
          ${d.conteudoArquivo ? `<button class="btn btn--pequeno" data-ver="${d.id}">Visualizar</button>
          <button class="btn btn--pequeno" data-baixar="${d.id}">Baixar</button>` : ''}
          <button class="btn btn--pequeno btn--perigo" data-excluir="${d.id}">Excluir</button></td>
      </tr>`;
    }).join('')}</tbody></table>`
      : '<div class="vazio"><span class="ico">📄</span>Nenhum documento.</div>';
  };

  delegar(tela, 'change', '[data-filtro]', (_e, el) => { filtro[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'input', 'input[data-filtro]', (_e, el) => { filtro[el.dataset.filtro] = el.value; desenhar(); });
  delegar(tela, 'click', '[data-acao="novo"]', () => abrirFormularioDocumento({}, desenhar));
  delegar(tela, 'click', '[data-ver]', (_e, el) => visualizarDocumento(db.obter('documentos', el.dataset.ver)));
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

/* ----------------------------------------------------------- visualização */

/** Formatos que o navegador exibe sem auxílio de programa externo. */
function formatoDe(documento) {
  const tipo = String(documento.tipo || '').toLowerCase();
  const nome = String(documento.nome || '').toLowerCase();
  if (tipo === 'application/pdf' || nome.endsWith('.pdf')) return 'pdf';
  if (tipo.startsWith('image/')) return 'imagem';
  if (tipo.startsWith('video/')) return 'video';
  if (tipo.startsWith('audio/')) return 'audio';
  if (tipo.startsWith('text/') || /\.(txt|csv|md|json|xml)$/.test(nome)) return 'texto';
  return 'desconhecido';
}

/**
 * Abre o documento em tela, sem baixar.
 *
 * O arquivo está gravado como data URL. Convertê-lo em blob antes de exibir
 * evita o bloqueio que o navegador impõe a data URL dentro de quadro e libera
 * a leitura de PDF com o visualizador nativo. O endereço temporário é
 * descartado ao fechar, para não deixar cópia do documento em memória.
 */
export async function visualizarDocumento(documento) {
  if (!documento?.conteudoArquivo) { aviso('Este registro não possui arquivo anexado.', 'atencao'); return; }
  const formato = formatoDe(documento);
  const blob = await (await fetch(documento.conteudoArquivo)).blob();
  const url = URL.createObjectURL(blob);

  let corpo;
  if (formato === 'pdf') {
    corpo = `<iframe class="visualizador" src="${url}#view=FitH" title="${esc(documento.nome)}"></iframe>`;
  } else if (formato === 'imagem') {
    corpo = `<div class="visualizador visualizador--centro"><img src="${url}" alt="${esc(documento.nome)}"></div>`;
  } else if (formato === 'video') {
    corpo = `<div class="visualizador visualizador--centro"><video src="${url}" controls></video></div>`;
  } else if (formato === 'audio') {
    corpo = `<div class="pilha"><audio src="${url}" controls style="width:100%"></audio></div>`;
  } else if (formato === 'texto') {
    corpo = `<pre class="visualizador visualizador--texto">${esc(await blob.text())}</pre>`;
  } else {
    corpo = `<div class="aviso aviso--info">Este formato não é exibido pelo navegador.
      ${esc(documento.tipo || 'tipo não identificado')}. Utilize o download para abrir no programa adequado.</div>`;
  }

  modal({
    titulo: documento.nome, largo: true,
    conteudo: `<div class="mini mudo" style="margin-bottom:.5rem">
        ${esc(documento.categoria || '')} · ${esc(tamanho(documento.tamanho))}
      </div>${corpo}`,
    acoes: [
      { rotulo: 'Baixar', aoClicar: () => baixarArquivo(documento.nome, blob) },
      { rotulo: 'Fechar', classe: 'btn--primario', aoClicar: (fechar) => fechar() },
    ],
    aoAbrir: (_corpo, fechar) => {
      // Libera o endereço temporário assim que a janela é encerrada.
      const observador = new MutationObserver(() => {
        if (!document.body.contains(_corpo)) { URL.revokeObjectURL(url); observador.disconnect(); }
      });
      observador.observe(document.body, { childList: true });
      void fechar;
    },
  });
}
