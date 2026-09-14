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
import { fmtCNJ } from '../core/util.js';
import { MARCA } from '../core/marca.js';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export function abrirPrimeiroAcesso(aoConcluir) {
  const usuario = usuarioAtual();
  const oabSalva = String(usuario?.oab || '').replace(/[^\d]/g, '');
  const ufSalva = (String(usuario?.oab || '').match(/[A-Z]{2}/) || [''])[0];

  const corpo = h(`<div class="pilha">
    <p class="quebra">Sua base começa vazia, pronta para os seus cadastros. Se preferir,
      o sistema pode procurar seus processos ativos nos tribunais a partir da sua inscrição
      na OAB e trazer apenas o que ainda está em andamento.</p>

    <div class="form__linha form__linha--3">
      <div class="campo"><label for="pa-oab">Inscrição na OAB</label>
        <input id="pa-oab" type="text" value="${esc(oabSalva)}" placeholder="Somente números"></div>
      <div class="campo"><label for="pa-uf">Seccional</label>
        <select id="pa-uf">${UFS.map((u) => `<option value="${u}" ${u === ufSalva ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="campo"><label>&nbsp;</label>
        <button type="button" class="btn btn--primario" id="pa-buscar">Pesquisar nos tribunais</button></div>
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

  const relatar = ({ importados, arquivados, duplicados, invalidos }) => {
    if (importados.length) {
      qs('#pa-resultado', corpo).innerHTML = `
        <div class="aviso aviso--ok">${importados.length} processo(s) ativo(s) importado(s).</div>
        <div class="mini mudo">${importados.slice(0, 12).map((p) => esc(fmtCNJ(p.numeroCNJ))).join(' · ')}</div>
        <div class="mini mudo" style="margin-top:.4rem">Vincule cada processo ao cliente correspondente
          em Processos. A consulta devolve as partes, mas não diz qual delas o escritório representa.</div>
        ${resumoDescartes({ arquivados, duplicados, invalidos })}`;
      aviso(`${importados.length} processo(s) importado(s).`, 'ok');
    } else {
      qs('#pa-resultado', corpo).innerHTML = `
        <div class="aviso aviso--atencao">Nenhum processo ativo foi importado.</div>
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
    titulo: `Bem-vindo ao ${MARCA}`, conteudo: corpo, largo: true,
    acoes: [{ rotulo: 'Começar', classe: 'btn--primario', aoClicar: (fechar) => { fechar(); aoConcluir?.(); } }],
  });

  qs('#pa-buscar', corpo).addEventListener('click', async () => {
    const oab = qs('#pa-oab', corpo).value.trim();
    const uf = qs('#pa-uf', corpo).value;
    const botao = qs('#pa-buscar', corpo);
    botao.disabled = true;
    botao.textContent = 'Pesquisando…';
    try {
      const r = await tribunais.consultarPorOAB({ oab, uf });
      if (!r.disponivel) {
        qs('#pa-resultado', corpo).innerHTML = `<div class="aviso aviso--info quebra">${esc(r.motivo)}</div>`;
        qs('#pa-manual', corpo).open = true;
        return;
      }
      relatar(tribunais.importar(r.processos, { responsavelId: usuario?.id || null }));
      // A inscrição fica guardada para as próximas consultas.
      if (oab) db.atualizar('usuarios', usuario.id, { oab: `OAB/${uf} ${oab}` }, 'Inscrição na OAB registrada');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Pesquisar nos tribunais';
    }
  });

  qs('#pa-importar', corpo).addEventListener('click', () => {
    const lista = interpretarListaProcessos(qs('#pa-lista', corpo).value);
    if (!lista.length) { aviso('Nenhum número de processo reconhecido na lista.', 'atencao'); return; }
    relatar(tribunais.importar(lista, { responsavelId: usuario?.id || null }));
  });

  return ref;
}
