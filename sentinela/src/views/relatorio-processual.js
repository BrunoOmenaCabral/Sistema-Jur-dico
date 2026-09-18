// Relatório processual: envio das movimentações do processo ao cliente.
//
// O texto é gerado a partir do que o sistema recebeu — publicações do DJEN,
// andamento processual e registros internos — e fica em edição até o envio.
// Nada sai para o cliente sem passar pela revisão do escritório.

import { h, qs, esc, delegar, aviso } from '../ui/ui.js';
import { cabecalhoPagina, opcoesClientes } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { relatorioProcessual } from '../core/ia.js';
import { whatsapp, email, baixarArquivo, atualizarPeloTribunal } from '../core/integracoes.js';
import { nomeCliente } from '../core/dominio.js';
import { hoje, addDays, fmtData, fmtCNJ } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';

export function relatorioProcessualView() {
  definirTitulo('Relatório processual');

  const estado = { clienteId: '', processoId: '', desde: addDays(hoje(), -30), conferir: true };

  const tela = h(`<div>
    ${cabecalhoPagina('Relatório processual',
    '<button class="btn" data-acao="baixar">Baixar</button>',
    'Movimentações do processo descritas em linguagem acessível e enviadas ao cliente.')}

    <section class="cartao" style="margin-bottom:.8rem"><div class="cartao__corpo">
      <div class="form__linha form__linha--3">
        <div class="campo"><label for="rp-cliente">Cliente</label>
          <select id="rp-cliente" data-campo="clienteId">
            <option value="">— selecione —</option>
            ${opcoesClientes().map((c) => `<option value="${esc(c.valor)}">${esc(c.rotulo)}</option>`).join('')}
          </select></div>
        <div class="campo"><label for="rp-processo">Processo</label>
          <select id="rp-processo" data-campo="processoId"><option value="">Todos os ativos do cliente</option></select></div>
        <div class="campo"><label for="rp-desde">Movimentações desde</label>
          <input id="rp-desde" type="date" data-campo="desde" value="${estado.desde}"></div>
      </div>
      <div class="campo campo--linha" style="margin-top:.2rem">
        <input type="checkbox" id="rp-conferir" data-campo="conferir" checked>
        <label for="rp-conferir">Conferir o andamento no tribunal antes de gerar</label>
        <span class="campo__ajuda">Consulta a base pública do CNJ e importa o que ainda não
          constava, para que o relatório não fique aquém do que o processo já tem.</span>
      </div>
      <div class="linha" style="margin-top:.4rem">
        <button class="btn btn--primario" data-acao="gerar">Gerar relatório</button>
        <span class="mini mudo" id="rp-resumo"></span>
      </div>
      <div id="rp-conferencia"></div>
    </div></section>

    <section class="cartao"><div class="cartao__corpo">
      <div class="campo"><label for="rp-texto">Texto do relatório</label>
        <textarea id="rp-texto" rows="18" placeholder="Selecione o cliente e gere o relatório."></textarea>
        <span class="campo__ajuda">Revise e ajuste livremente antes de enviar.</span></div>
      <div class="linha" style="margin-top:.6rem">
        <button class="btn btn--primario" data-acao="whatsapp">Enviar por WhatsApp</button>
        <button class="btn" data-acao="email">Enviar por e-mail</button>
      </div>
    </div></section>
  </div>`);

  const texto = () => qs('#rp-texto', tela);

  /** O seletor de processo acompanha o cliente escolhido. */
  const atualizarProcessos = () => {
    const lista = estado.clienteId
      ? db.listar('processos', { clienteId: estado.clienteId }).filter((p) => p.status === 'ativo')
      : [];
    qs('#rp-processo', tela).innerHTML = '<option value="">Todos os ativos do cliente</option>'
      + lista.map((p) => `<option value="${esc(p.id)}">${esc(fmtCNJ(p.numeroCNJ))} — ${esc(p.assunto || p.classe || '')}</option>`).join('');
    estado.processoId = '';
  };

  /** Processos que o relatório vai cobrir, na mesma regra do gerador. */
  const escopo = () => (estado.processoId
    ? [db.obter('processos', estado.processoId)].filter(Boolean)
    : db.listar('processos', { clienteId: estado.clienteId }).filter((p) => p.status === 'ativo'));

  /**
   * Antes de compor o texto, busca no tribunal o que ainda não foi importado.
   * É o que evita o relatório silenciar sobre a petição juntada há poucos dias.
   */
  const conferir = async () => {
    const lista = escopo();
    if (!lista.length) return null;
    const painel = qs('#rp-conferencia', tela);
    let importados = 0;
    const falhos = [];

    for (const [i, p] of lista.entries()) {
      painel.innerHTML = `<div class="aviso aviso--info">Conferindo ${i + 1} de ${lista.length}
        no tribunal — ${esc(fmtCNJ(p.numeroCNJ))}…</div>`;
      try {
        const r = await atualizarPeloTribunal(p.id);
        if (r.ok) importados += r.importados;
        else falhos.push(`${fmtCNJ(p.numeroCNJ)}: ${r.motivo}`);
      } catch (e) {
        falhos.push(`${fmtCNJ(p.numeroCNJ)}: ${e.message}`);
      }
    }

    painel.innerHTML = [
      `<div class="aviso aviso--${falhos.length ? 'atencao' : 'ok'}">`,
      `${lista.length} processo(s) conferido(s) no tribunal · `,
      `${importados} movimentação(ões) nova(s) importada(s).`,
      falhos.length ? `<div class="mini">Sem resposta: ${esc(falhos.join(' · '))}</div>` : '',
      '</div>',
    ].join('');
    return { importados, falhos };
  };

  const gerar = async () => {
    if (!estado.clienteId) { aviso('Selecione o cliente.', 'atencao'); return null; }
    if (estado.conferir) await conferir();
    const r = relatorioProcessual({
      clienteId: estado.clienteId,
      processoId: estado.processoId || null,
      desde: estado.desde || null,
    });
    if (r.vazio) {
      qs('#rp-resumo', tela).textContent = 'Este cliente não possui processo ativo cadastrado.';
      texto().value = '';
      return null;
    }
    texto().value = r.texto;
    qs('#rp-resumo', tela).textContent = `${r.processos.length} processo(s) · `
      + `${r.totalMovimentos} movimentação(ões) desde ${fmtData(r.desde)}`;
    // Processo nunca conferido na origem: o relatório pode estar incompleto e o
    // escritório precisa saber disso antes de enviar ao cliente.
    if (r.semConferencia?.length) {
      qs('#rp-conferencia', tela).innerHTML = `<div class="aviso aviso--atencao">
        ${r.semConferencia.length} processo(s) nunca foram conferidos no tribunal:
        ${esc(r.semConferencia.map((p) => fmtCNJ(p.numeroCNJ)).join(', '))}. O relatório traz
        apenas o que já está cadastrado.</div>`;
    }
    return r;
  };

  const conteudo = () => {
    const t = texto().value.trim();
    if (!t) { aviso('Gere o relatório antes de enviar.', 'atencao'); return null; }
    if (!estado.clienteId) { aviso('Selecione o cliente.', 'atencao'); return null; }
    return t;
  };

  delegar(tela, 'change', '[data-campo]', (_e, el) => {
    estado[el.dataset.campo] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.campo === 'clienteId') atualizarProcessos();
  });
  delegar(tela, 'click', '[data-acao="gerar"]', async (_e, el) => {
    el.disabled = true;
    const rotulo = el.textContent;
    el.textContent = 'Gerando…';
    try { await gerar(); } finally { el.disabled = false; el.textContent = rotulo; }
  });

  delegar(tela, 'click', '[data-acao="whatsapp"]', async () => {
    const mensagem = conteudo();
    if (!mensagem) return;
    try {
      await whatsapp.enviar({ clienteId: estado.clienteId, processoId: estado.processoId || null, mensagem });
      aviso('Relatório enviado e registrado no histórico de comunicações.', 'ok');
    } catch (e) { aviso(e.message, 'erro'); }
  });

  delegar(tela, 'click', '[data-acao="email"]', async () => {
    const mensagem = conteudo();
    if (!mensagem) return;
    try {
      await email.enviar({
        clienteId: estado.clienteId, processoId: estado.processoId || null,
        assunto: 'Relatório processual', mensagem,
      });
      aviso('Relatório enviado e registrado no histórico de comunicações.', 'ok');
    } catch (e) { aviso(e.message, 'erro'); }
  });

  delegar(tela, 'click', '[data-acao="baixar"]', () => {
    const t = conteudo();
    if (!t) return;
    baixarArquivo(`relatorio-processual-${nomeCliente(estado.clienteId).replace(/\s+/g, '-').toLowerCase()}-${hoje()}.txt`, t);
  });

  atualizarProcessos();
  return tela;
}
