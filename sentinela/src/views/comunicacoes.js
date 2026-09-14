// Comunicações com o cliente: histórico e automações de WhatsApp/e-mail.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina, opcoesClientes, opcoesProcessos } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { nomeCliente, processoDe } from '../core/dominio.js';
import { whatsapp, email, automacoesPendentes, MODELOS_MENSAGEM, contextoMensagem } from '../core/integracoes.js';
import { fmtDataHora, fmtCNJ } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';

export function comunicacoes() {
  definirTitulo('Comunicações');
  const tela = h(`<div>
    ${cabecalhoPagina('Comunicações', `
      <button class="btn btn--primario" data-acao="nova">Nova mensagem</button>`)}
    <div id="painel"></div>
  </div>`);

  const desenhar = () => {
    const fila = automacoesPendentes();
    const historico = db.listar('comunicacoes')
      .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)));

    qs('#painel', tela).innerHTML = `
      <section class="cartao" style="margin-bottom:.8rem">
        <div class="cartao__cabecalho"><h3>Automações previstas para hoje</h3>
          <span class="mini mudo">configuráveis pelo administrador</span></div>
        <div class="cartao__corpo cartao__corpo--liso">
          ${fila.length ? `<ul class="lista">${fila.map((f, i) => `
            <li class="lista__item">
              <span class="lista__faixa" style="background:var(--c-audiencia)"></span>
              <div class="lista__corpo"><div class="lista__titulo">${esc(nomeCliente(f.clienteId))}
                <span class="selo">${esc(f.tipo)}</span></div>
                <div class="lista__meta quebra">${esc(f.mensagem)}</div></div>
              <div class="lista__lado"><button class="btn btn--pequeno" data-enviar="${i}">Enviar</button></div>
            </li>`).join('')}</ul>`
    : '<div class="vazio">Nenhuma automação prevista para hoje.</div>'}
        </div>
      </section>

      <section class="cartao">
        <div class="cartao__cabecalho"><h3>Histórico</h3></div>
        <div class="cartao__corpo cartao__corpo--liso">
          ${historico.length ? `<ul class="lista">${historico.map((m) => `
            <li class="lista__item">
              <span class="lista__faixa" style="background:${m.canal === 'whatsapp' ? 'var(--c-concluido)' : 'var(--c-audiencia)'}"></span>
              <div class="lista__corpo">
                <div class="lista__titulo">${esc(m.canal)} — ${esc(nomeCliente(m.clienteId))}</div>
                <div class="lista__meta quebra">${esc(m.mensagem)}</div>
                <div class="mini mudo">${m.processoId ? esc(fmtCNJ(processoDe(m.processoId)?.numeroCNJ)) : ''} ${esc(m.status || '')}</div>
              </div>
              <div class="lista__lado">${esc(fmtDataHora(m.enviadoEm))}</div>
            </li>`).join('')}</ul>` : '<div class="vazio">Nenhuma comunicação registrada.</div>'}
        </div>
      </section>`;

    tela._fila = fila;
  };

  delegar(tela, 'click', '[data-enviar]', async (_e, el) => {
    const f = tela._fila[Number(el.dataset.enviar)];
    try { await whatsapp.enviar(f); aviso('Mensagem registrada.', 'ok'); desenhar(); }
    catch (err) { aviso(err.message, 'erro'); }
  });
  delegar(tela, 'click', '[data-acao="nova"]', () => abrirNovaMensagem(desenhar));
  desenhar();
  return tela;
}

function abrirNovaMensagem(aoConcluir) {
  const campos = [
    { nome: 'clienteId', rotulo: 'Cliente', tipo: 'select', opcoes: opcoesClientes(), obrigatorio: true, largura: 2 },
    { nome: 'processoId', rotulo: 'Processo', tipo: 'select', opcoes: opcoesProcessos() },
    { nome: 'canal', rotulo: 'Canal', tipo: 'select', vazio: false,
      opcoes: [{ valor: 'whatsapp', rotulo: 'WhatsApp' }, { valor: 'email', rotulo: 'E-mail' },
        { valor: 'ambos', rotulo: 'Ambos' }] },
    { nome: 'modelo', rotulo: 'Modelo', tipo: 'select',
      opcoes: [{ valor: 'atualizacao', rotulo: 'Atualização processual' },
        { valor: 'documentos', rotulo: 'Solicitação de documentos' },
        { valor: 'prazoProximo', rotulo: 'Providência em andamento' },
        { valor: 'relatorioMensal', rotulo: 'Relatório disponível' }], largura: 2 },
    { nome: 'assunto', rotulo: 'Assunto (e-mail)', tipo: 'text', largura: 2 },
    { nome: 'mensagem', rotulo: 'Mensagem', tipo: 'textarea', obrigatorio: true, largura: 3 },
  ];

  const ref = modalFormulario({
    titulo: 'Nova mensagem', campos, largo: true, rotuloSalvar: 'Enviar',
    valores: { canal: 'whatsapp', assunto: 'Atualização processual' },
    aoSalvar: async (d) => {
      try {
        if (d.canal === 'whatsapp' || d.canal === 'ambos') {
          await whatsapp.enviar({ clienteId: d.clienteId, processoId: d.processoId, mensagem: d.mensagem });
        }
        if (d.canal === 'email' || d.canal === 'ambos') {
          await email.enviar({ clienteId: d.clienteId, processoId: d.processoId,
            assunto: d.assunto || 'Comunicação do escritório', mensagem: d.mensagem });
        }
        aviso('Comunicação registrada.', 'ok');
        aoConcluir?.();
      } catch (e) { aviso(e.message, 'erro'); return false; }
    },
  });

  const preencher = () => {
    const modelo = ref.form.elements.modelo.value;
    const clienteId = ref.form.elements.clienteId.value;
    const processoId = ref.form.elements.processoId.value;
    if (!modelo || !clienteId) return;
    ref.form.elements.mensagem.value = MODELOS_MENSAGEM[modelo](contextoMensagem({ clienteId, processoId }));
  };
  ref.form.elements.modelo.addEventListener('change', preencher);
  ref.form.elements.clienteId.addEventListener('change', preencher);
  ref.form.elements.processoId.addEventListener('change', preencher);
}
