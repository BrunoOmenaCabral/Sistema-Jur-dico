// Primeiro acesso: o sistema começa vazio e oferece povoar a base com os
// processos ativos do advogado.
//
// A busca por OAB depende de provedor contratado, porque os sistemas oficiais
// exigem certificado digital ou credencial em cada tribunal. Sem provedor, a
// tela não inventa processo algum: explica a limitação e importa a lista que o
// próprio tribunal exporta.

import { h, qs, esc, aviso, modal } from '../ui/ui.js';
import { db } from '../core/store.js';
import { usuarioAtual } from '../core/auth.js';
import { tribunais, interpretarListaProcessos } from '../core/integracoes.js';
import { fmtCNJ, fmtData, hoje, addDays } from '../core/util.js';
import { MARCA } from '../core/marca.js';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export function abrirConsultaProcessual(aoConcluir, { boasVindas = false } = {}) {
  const usuario = usuarioAtual();
  const oabSalva = String(usuario?.oab || '').replace(/[^\d]/g, '');
  const ufSalva = (String(usuario?.oab || '').match(/[A-Z]{2}/) || [''])[0];

  const corpo = h(`<div class="pilha">
    <p class="quebra">${boasVindas ? 'Sua base começa vazia, pronta para os seus cadastros. Se preferir, o' : 'O'}
      sistema consulta o Diário de Justiça Eletrônico Nacional pela sua inscrição na OAB e
      traz os processos em que você foi intimado no período, descartando os que já tiveram
      baixa definitiva. Processos já cadastrados não são duplicados. A consulta é pública e
      não exige certificado digital.</p>

    <div class="form__linha form__linha--3">
      <div class="campo"><label for="pa-oab">Inscrição na OAB</label>
        <input id="pa-oab" type="text" value="${esc(oabSalva)}" placeholder="Somente números"></div>
      <div class="campo"><label for="pa-uf">Seccional</label>
        <select id="pa-uf">${UFS.map((u) => `<option value="${u}" ${u === ufSalva ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="campo"><label for="pa-periodo">Intimações dos últimos</label>
        <select id="pa-periodo">
          <option value="90">3 meses</option>
          <option value="180" selected>6 meses</option>
          <option value="365">12 meses</option>
        </select></div>
    </div>

    <div class="campo campo--linha">
      <input type="checkbox" id="pa-publicacoes" checked>
      <label for="pa-publicacoes">Trazer também as intimações para a fila de conferência de publicações</label>
    </div>

    <div class="linha">
      <button type="button" class="btn btn--primario" id="pa-buscar">Pesquisar na consulta pública</button>
      <span class="mini mudo">Fonte: Diário de Justiça Eletrônico Nacional, do CNJ.</span>
    </div>

    <div id="pa-resultado"></div>

    <details id="pa-manual">
      <summary class="mini">Importar lista exportada do tribunal</summary>
      <div class="campo" style="margin-top:.5rem">
        <label for="pa-lista">Processos</label>
        <textarea id="pa-lista" rows="7" placeholder="Um processo por linha.&#10;Apenas o número, ou número;classe;assunto;vara;tribunal;situação"></textarea>
        <span class="campo__ajuda">Processos com baixa ou arquivamento definitivo são descartados
          automaticamente. Arquivamento provisório e suspensão são mantidos.</span>
      </div>
      <button type="button" class="btn btn--primario" id="pa-importar">Importar processos ativos</button>
    </details>
  </div>`);

  const relatar = ({ importados, arquivados, duplicados, invalidos }, extra = {}) => {
    const origem = extra.comunicacoes
      ? `<div class="mini mudo">${extra.comunicacoes} intimação(ões) lida(s) no DJEN.`
        + `${extra.publicacoes ? ` ${extra.publicacoes.importadas} enviada(s) à fila de conferência.` : ''}</div>`
      : '';
    if (importados.length) {
      qs('#pa-resultado', corpo).innerHTML = `
        <div class="aviso aviso--ok">${importados.length} processo(s) ativo(s) importado(s).</div>
        ${origem}
        <div class="mini mudo">${importados.slice(0, 12).map((p) => esc(fmtCNJ(p.numeroCNJ))).join(' · ')}</div>
        <div class="mini mudo" style="margin-top:.4rem">Vincule cada processo ao cliente correspondente
          em Processos. A consulta devolve as partes, mas não diz qual delas o escritório representa.</div>
        ${resumoDescartes({ arquivados, duplicados, invalidos })}`;
      aviso(`${importados.length} processo(s) importado(s).`, 'ok');
    } else {
      qs('#pa-resultado', corpo).innerHTML = `
        <div class="aviso aviso--atencao">Nenhum processo ativo foi importado.</div>
        ${origem}
        ${resumoDescartes({ arquivados, duplicados, invalidos })}`;
    }
  };

  const resumoDescartes = ({ arquivados, duplicados, invalidos }) => {
    const partes = [];
    if (arquivados.length) partes.push(`${arquivados.length} com baixa definitiva`);
    if (duplicados.length) partes.push(`${duplicados.length} já cadastrado(s)`);
    if (invalidos.length) partes.push(`${invalidos.length} sem número CNJ válido`);
    return partes.length ? `<div class="mini mudo">Fora da importação: ${partes.join(', ')}.</div>` : '';
  };

  const ref = modal({
    titulo: boasVindas ? `Bem-vindo ao ${MARCA}` : 'Consulta processual pela OAB',
    conteudo: corpo, largo: true,
    acoes: [{ rotulo: 'Começar', classe: 'btn--primario', aoClicar: (fechar) => { fechar(); aoConcluir?.(); } }],
  });

  qs('#pa-buscar', corpo).addEventListener('click', async () => {
    const oab = qs('#pa-oab', corpo).value.trim();
    const uf = qs('#pa-uf', corpo).value;
    const dias = Number(qs('#pa-periodo', corpo).value);
    const trazerPublicacoes = qs('#pa-publicacoes', corpo).checked;
    const botao = qs('#pa-buscar', corpo);
    const de = addDays(hoje(), -dias);

    botao.disabled = true;
    botao.textContent = 'Consultando o CNJ…';
    qs('#pa-resultado', corpo).innerHTML = '<div class="mini mudo">Consultando as comunicações '
      + `disponibilizadas entre ${esc(fmtData(de))} e ${esc(fmtData(hoje()))}…</div>`;

    try {
      const r = await tribunais.consultarPorOAB({ oab, uf, de, ate: hoje() });
      if (!r.disponivel) {
        qs('#pa-resultado', corpo).innerHTML = `<div class="aviso aviso--atencao quebra">${esc(r.motivo)}</div>`;
        qs('#pa-manual', corpo).open = true;
        return;
      }
      if (!r.processos.length) {
        qs('#pa-resultado', corpo).innerHTML = '<div class="aviso aviso--info">Nenhuma intimação '
          + 'localizada para esta inscrição no período. Amplie o intervalo ou importe a lista do tribunal.</div>';
        qs('#pa-manual', corpo).open = true;
        return;
      }

      const resultado = tribunais.importar(r.processos, { responsavelId: usuario?.id || null });
      let publicacoes = null;
      if (trazerPublicacoes) publicacoes = tribunais.importarComunicacoes(r.comunicacoes);
      relatar(resultado, { comunicacoes: r.comunicacoes.length, publicacoes });

      // A inscrição fica guardada para as próximas consultas.
      if (oab) db.atualizar('usuarios', usuario.id, { oab: `OAB/${uf} ${oab}` }, 'Inscrição na OAB registrada');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Pesquisar na consulta pública';
    }
  });

  qs('#pa-importar', corpo).addEventListener('click', () => {
    const lista = interpretarListaProcessos(qs('#pa-lista', corpo).value);
    if (!lista.length) { aviso('Nenhum número de processo reconhecido na lista.', 'atencao'); return; }
    relatar(tribunais.importar(lista, { responsavelId: usuario?.id || null }));
  });

  return ref;
}
