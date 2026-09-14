// Assistente jurídico: leitura de publicações e consultas sobre o processo,
// sempre restritas aos dados cadastrados.

import { h, qs, esc, delegar, aviso } from '../ui/ui.js';
import { cabecalhoPagina, opcoesProcessos } from '../ui/componentes.js';
import { interpretarPublicacao, assistenteProcesso, relatorioCliente } from '../core/ia.js';
import { db } from '../core/store.js';
import { fmtData, fmtCNJ } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';
import { ir } from '../ui/roteador.js';

const SUGESTOES = [
  'Resuma o que aconteceu neste processo nos últimos 30 dias.',
  'Quais prazos estão em aberto?',
  'Há audiência marcada?',
  'Quais documentos estão anexados?',
];

export function ia() {
  definirTitulo('Assistente');
  const tela = h(`<div>
    ${cabecalhoPagina('Assistente jurídico',
    '', 'A resposta utiliza exclusivamente os dados cadastrados. O que não estiver na base é informado como indisponível.')}

    <div class="abas">
      <div class="aba ativa" data-aba="publicacao">Analisar publicação</div>
      <div class="aba" data-aba="processo">Perguntar sobre um processo</div>
    </div>

    <div id="painel-publicacao">
      <section class="cartao"><div class="cartao__corpo">
        <div class="campo"><label>Texto da publicação</label>
          <textarea id="texto-pub" style="min-height:150px" placeholder="Cole aqui o texto da intimação ou publicação…"></textarea></div>
        <div class="form__linha form__linha--3" style="margin-top:.5rem">
          <div class="campo"><label>Data da publicação</label><input type="date" id="data-pub"></div>
          <div class="campo"><label>Disponibilização</label><input type="date" id="data-disp"></div>
          <div class="campo"><label>&nbsp;</label>
            <button class="btn btn--primario" data-acao="analisar">Analisar</button></div>
        </div>
        <div id="saida-pub" style="margin-top:.7rem"></div>
      </div></section>
    </div>

    <div id="painel-processo" class="oculto">
      <section class="cartao"><div class="cartao__corpo">
        <div class="campo"><label>Processo</label>
          <select id="proc-sel"><option value="">— selecione —</option>
          ${opcoesProcessos().map((p) => `<option value="${p.valor}">${esc(p.rotulo)}</option>`).join('')}</select></div>
        <div class="campo" style="margin-top:.5rem"><label>Pergunta</label>
          <input id="pergunta" placeholder="${esc(SUGESTOES[0])}"></div>
        <div class="linha" style="margin-top:.5rem">
          ${SUGESTOES.map((s) => `<button class="btn btn--pequeno" data-sugestao="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
        <button class="btn btn--primario" style="margin-top:.6rem" data-acao="perguntar">Consultar</button>
        <div id="saida-proc" style="margin-top:.7rem"></div>
      </div></section>
    </div>
  </div>`);

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    qs('#painel-publicacao', tela).classList.toggle('oculto', el.dataset.aba !== 'publicacao');
    qs('#painel-processo', tela).classList.toggle('oculto', el.dataset.aba !== 'processo');
  });

  delegar(tela, 'click', '[data-acao="analisar"]', () => {
    const conteudo = qs('#texto-pub', tela).value.trim();
    if (!conteudo) { aviso('Cole o texto da publicação.', 'erro'); return; }
    const s = interpretarPublicacao({
      conteudo,
      dataPublicacao: qs('#data-pub', tela).value || null,
      dataDisponibilizacao: qs('#data-disp', tela).value || null,
    });
    qs('#saida-pub', tela).innerHTML = `
      <div class="aviso aviso--atencao">⚠️ Sugestão automática. O prazo só entra na agenda após confirmação.</div>
      <dl class="chave-valor">
        <dt>Processo</dt><dd>${s.processoId ? `<a href="#/processos/${s.processoId}" class="mono">${esc(fmtCNJ(s.numeroCNJ))}</a>`
    : `<span class="mono">${esc(fmtCNJ(s.numeroCNJ) || 'não identificado')}</span> <span class="selo selo--fatal">não cadastrado</span>`}</dd>
        <dt>Tipo</dt><dd>${esc(s.tipoRotulo)}</dd>
        <dt>Prazo</dt><dd>${s.dias ? `${s.dias} ${s.contagem === 'uteis' ? 'dias úteis' : 'dias corridos'}` : 'não identificado'}</dd>
        <dt>Início</dt><dd>${esc(fmtData(s.inicioSugerido))}</dd>
        <dt>Vencimento</dt><dd class="negrito">${esc(fmtData(s.vencimentoSugerido))}</dd>
        <dt>Confiança</dt><dd>${s.confianca}%</dd>
      </dl>
      ${(s.alertas || []).map((a) => `<div class="aviso aviso--atencao">${esc(a)}</div>`).join('')}
      ${s.calculo ? `<details><summary class="mini">Memória de cálculo</summary>
        ${s.calculo.passos.map((x) => `<div class="mini mudo">• ${esc(x)}</div>`).join('')}</details>` : ''}`;
  });

  delegar(tela, 'click', '[data-sugestao]', (_e, el) => { qs('#pergunta', tela).value = el.dataset.sugestao; });
  delegar(tela, 'click', '[data-acao="perguntar"]', () => {
    const processoId = qs('#proc-sel', tela).value;
    if (!processoId) { aviso('Selecione o processo.', 'erro'); return; }
    const r = assistenteProcesso(processoId, qs('#pergunta', tela).value || SUGESTOES[0]);
    qs('#saida-proc', tela).innerHTML = `<div class="cartao"><div class="cartao__corpo">
      <div class="quebra">${esc(r.resposta)}</div></div></div>`;
  });
  return tela;
}
