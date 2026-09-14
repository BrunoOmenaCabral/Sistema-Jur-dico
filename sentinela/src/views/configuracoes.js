// Configurações: escritório, régua de alertas, cores, calendário forense,
// integrações, auditoria, lixeira e backup.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina } from '../ui/componentes.js';
import { db, COLECOES, modoAtual, sincronizarCompleto } from '../core/store.js';
import { pode } from '../core/auth.js';
import { fmtData, fmtDataHora, hoje } from '../core/util.js';
import { baixarArquivo } from '../core/integracoes.js';
import { definirTitulo } from '../ui/casca.js';

export function configuracoes() {
  definirTitulo('Configurações');
  let aba = 'geral';

  const tela = h(`<div>
    ${cabecalhoPagina('Configurações')}
    <div class="abas">
      <div class="aba ativa" data-aba="geral">Escritório e alertas</div>
      <div class="aba" data-aba="calendario">Calendário forense</div>
      <div class="aba" data-aba="integracoes">Integrações</div>
      <div class="aba" data-aba="auditoria">Auditoria</div>
      <div class="aba" data-aba="lixeira">Lixeira</div>
      <div class="aba" data-aba="backup">Backup e dados</div>
    </div>
    <div id="painel"></div>
  </div>`);

  const paineis = {
    geral: () => {
      const c = db.config();
      return `<div class="grade grade--2">
        <section class="cartao"><div class="cartao__corpo">
          <h3>Escritório</h3>
          <div class="form" style="margin-top:.6rem">
            <div class="campo"><label>Nome</label><input data-esc="nome" value="${esc(c.escritorio.nome)}"></div>
            <div class="campo"><label>E-mail</label><input data-esc="email" value="${esc(c.escritorio.email || '')}"></div>
            <div class="campo"><label>Telefone</label><input data-esc="telefone" value="${esc(c.escritorio.telefone || '')}"></div>
            <button class="btn btn--primario" data-acao="salvar-escritorio">Salvar</button>
          </div>
        </div></section>

        <section class="cartao"><div class="cartao__corpo">
          <h3>Régua de alertas</h3>
          <div class="campo" style="margin-top:.6rem">
            <label>Dias de antecedência (padrão para novos prazos)</label>
            <input id="alertas" value="${esc((c.alertasPadrao || []).join(', '))}">
            <span class="campo__ajuda">0 representa o alerta no dia do vencimento.</span>
          </div>
          <div class="campo campo--linha" style="margin-top:.5rem">
            <input type="checkbox" id="recesso" ${c.recessoForense !== false ? 'checked' : ''}>
            <label for="recesso">Aplicar suspensão de 20/12 a 20/01 (art. 220 do CPC)</label>
          </div>
          <button class="btn btn--primario" style="margin-top:.5rem" data-acao="salvar-alertas">Salvar</button>
        </div></section>

        <section class="cartao"><div class="cartao__corpo">
          <h3>Cores</h3>
          <div class="form" style="margin-top:.6rem">
            ${Object.entries(c.cores).map(([k, v]) => `<div class="campo campo--linha">
              <input type="color" data-cor="${k}" value="${esc(v)}">
              <label>${esc(k)}</label></div>`).join('')}
            <button class="btn btn--primario" data-acao="salvar-cores">Salvar cores</button>
          </div>
        </div></section>

        <section class="cartao"><div class="cartao__corpo">
          <h3>Automações de WhatsApp</h3>
          <div class="form" style="margin-top:.6rem">
            ${Object.entries(c.automacoesWhatsapp).map(([k, v]) => `<div class="campo campo--linha">
              <input type="checkbox" data-auto="${k}" ${v.ativo ? 'checked' : ''}>
              <label>${esc(k)}${v.antecedencia !== undefined ? ` (${v.antecedencia} dias antes)` : ''}</label></div>`).join('')}
            <button class="btn btn--primario" data-acao="salvar-automacoes">Salvar</button>
          </div>
        </div></section>
      </div>`;
    },

    calendario: () => `<div class="grade grade--2">
      <section class="cartao">
        <div class="cartao__cabecalho"><h3>Feriados cadastrados</h3>
          <button class="btn btn--pequeno" data-acao="novo-feriado">Adicionar</button></div>
        <div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
          <table class="tabela"><thead><tr><th>Data</th><th>Nome</th><th>Abrangência</th><th></th></tr></thead>
          <tbody>${db.listar('feriados').map((f) => `<tr>
            <td>${esc(fmtData(f.data))}</td><td>${esc(f.nome)}</td>
            <td>${esc(f.abrangencia)}${f.uf ? ` / ${esc(f.uf)}` : ''}${f.municipio ? ` / ${esc(f.municipio)}` : ''}</td>
            <td><button class="btn btn--pequeno btn--perigo" data-del-feriado="${f.id}">×</button></td></tr>`).join('')}
          </tbody></table>
          <div class="mini mudo" style="padding:.6rem">Os feriados nacionais, inclusive os móveis, são
            calculados automaticamente para qualquer ano.</div>
        </div>
      </section>

      <section class="cartao">
        <div class="cartao__cabecalho"><h3>Suspensões de expediente</h3>
          <button class="btn btn--pequeno" data-acao="nova-suspensao">Adicionar</button></div>
        <div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
          <table class="tabela"><thead><tr><th>Período</th><th>Descrição</th><th>Abrangência</th><th></th></tr></thead>
          <tbody>${db.listar('suspensoes').map((s) => `<tr>
            <td>${esc(fmtData(s.inicio))} a ${esc(fmtData(s.fim))}</td><td>${esc(s.descricao)}</td>
            <td>${esc(s.abrangencia || 'nacional')}${s.tribunal ? ` / ${esc(s.tribunal)}` : ''}</td>
            <td><button class="btn btn--pequeno btn--perigo" data-del-susp="${s.id}">×</button></td></tr>`).join('')}
          </tbody></table>
        </div>
      </section>
    </div>`,

    integracoes: () => {
      const i = db.config().integracoes;
      return `<div class="grade grade--2">
        ${[['publicacoes', 'Publicações', 'Provedor de monitoramento de diários oficiais.'],
    ['ia', 'Inteligência artificial', 'Provedor de leitura assistida. Sem provedor, é usada a análise heurística local.'],
    ['whatsapp', 'WhatsApp', 'API oficial do WhatsApp Business. Sem provedor, o sistema abre o WhatsApp Web.'],
    ['email', 'E-mail', 'Servidor de envio. Sem servidor, é aberto o cliente de e-mail padrão.'],
    ['calendario', 'Calendário externo', 'Exportação unidirecional. A agenda do sistema é a fonte principal.']]
    .map(([chave, titulo, texto]) => `
      <section class="cartao"><div class="cartao__corpo">
        <div class="linha linha--entre"><h3>${esc(titulo)}</h3>
          <span class="selo selo--${i[chave]?.ativo ? 'ok' : 'neutro'}">${i[chave]?.ativo ? 'ativa' : 'inativa'}</span></div>
        <div class="mini mudo" style="margin:.4rem 0">${esc(texto)}</div>
        <div class="campo campo--linha"><input type="checkbox" data-int="${chave}" ${i[chave]?.ativo ? 'checked' : ''}>
          <label>Ativar integração</label></div>
        <div class="campo"><label>Provedor / endpoint</label>
          <input data-int-campo="${chave}:provedor" value="${esc(i[chave]?.provedor || '')}"></div>
        <div class="campo"><label>Credencial</label>
          <input type="password" data-int-campo="${chave}:chave" value="${esc(i[chave]?.chave || i[chave]?.token || '')}"
            autocomplete="off"></div>
      </div></section>`).join('')}
      </div>
      <div class="linha" style="margin-top:.7rem">
        <button class="btn btn--primario" data-acao="salvar-integracoes">Salvar integrações</button>
      </div>
      <div class="aviso aviso--info" style="margin-top:.7rem">
        As credenciais ficam neste navegador. Em produção devem ser guardadas no servidor,
        com acesso restrito e registro de uso.
      </div>`;
    },

    auditoria: () => {
      const lista = db.listar('auditoria', { incluirExcluidos: true }).slice(0, 300);
      return `<div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
        <table class="tabela"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th>
        <th>Registro</th><th>Detalhe</th></tr></thead>
        <tbody>${lista.map((a) => `<tr><td>${esc(fmtDataHora(a.quando))}</td>
          <td>${esc(a.usuarioNome)}</td><td>${esc(a.acao)}</td>
          <td>${esc(a.colecao)}</td><td>${esc(a.detalhe || '')}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    },

    lixeira: () => {
      const itens = COLECOES.flatMap((c) => db.listar(c, { incluirExcluidos: true })
        .filter((r) => r.excluidoEm).map((r) => ({ ...r, colecao: c })));
      return `<div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem">
        ${itens.length ? `<table class="tabela"><thead><tr><th>Tipo</th><th>Identificação</th>
          <th>Excluído em</th><th>Motivo</th><th></th></tr></thead>
        <tbody>${itens.map((r) => `<tr>
          <td>${esc(r.colecao)}</td>
          <td>${esc(r.nome || r.titulo || r.descricao || r.numeroCNJ || r.id)}</td>
          <td>${esc(fmtDataHora(r.excluidoEm))}</td><td>${esc(r.motivoExclusao || '—')}</td>
          <td class="linha"><button class="btn btn--pequeno" data-restaurar="${r.colecao}:${r.id}">Restaurar</button>
          <button class="btn btn--pequeno btn--perigo" data-definitivo="${r.colecao}:${r.id}">Excluir definitivamente</button></td>
        </tr>`).join('')}</tbody></table>`
    : '<div class="vazio">Lixeira vazia.</div>'}
      </div></div>`;
    },

    backup: () => `<div class="grade grade--2">
      <section class="cartao"><div class="cartao__corpo">
        <h3>Backup</h3>
        <p class="mini mudo">${modoAtual() === 'servidor'
    ? 'A exportação gera uma cópia do que está no servidor, em JSON. A cópia oficial do '
      + 'escritório é o arquivo do banco de dados no servidor, que deve ser incluído na '
      + 'rotina de backup da máquina.'
    : 'Exporte periodicamente. O arquivo contém todos os cadastros, prazos, documentos '
      + 'anexados e o registro de auditoria.'}</p>
        <div class="linha">
          <button class="btn btn--primario" data-acao="exportar">Exportar backup</button>
          ${modoAtual() === 'servidor' ? '' : '<button class="btn" data-acao="importar">Importar backup</button>'}
        </div>
        <div class="mini mudo" style="margin-top:.5rem">
          ${modoAtual() === 'servidor' ? 'Conectado ao servidor. Os dados são compartilhados por toda a equipe.'
    : 'Cópia diária automática no navegador: ativa.'}
        </div>
      </div></section>
      <section class="cartao"><div class="cartao__corpo">
        <h3>Base de demonstração</h3>
        <p class="mini mudo">Cria clientes, processos, prazos, publicações e audiências de exemplo
          para conhecer o sistema. Use apenas em ambiente de teste.</p>
        <button class="btn" data-acao="demonstracao"
          ${db.listar('clientes').length ? 'disabled title="Disponível apenas com a base vazia"' : ''}>
          Carregar dados de demonstração</button>
      </div></section>
      <section class="cartao"><div class="cartao__corpo">
        <h3>Zona restrita</h3>
        <p class="mini mudo">${modoAtual() === 'servidor'
    ? 'A limpeza total da base do servidor é feita fora do sistema, com acesso ao arquivo do '
      + 'banco de dados. Aqui só é possível excluir registro a registro, com trilha de auditoria.'
    : 'A limpeza remove todos os dados deste navegador. Exporte antes.'}</p>
        ${modoAtual() === 'servidor' ? ''
    : '<button class="btn btn--perigo" data-acao="zerar">Apagar todos os dados</button>'}
      </div></section>
      <section class="cartao"><div class="cartao__corpo">
        <h3>Proteção de dados</h3>
        <ul class="mini mudo" style="padding-left:1rem">
          <li>Exclusão lógica com recuperação pela lixeira.</li>
          <li>Registro de auditoria de todas as alterações relevantes.</li>
          <li>Senhas guardadas apenas como hash com sal individual.</li>
          <li>Confirmação obrigatória antes de qualquer exclusão.</li>
          <li>Dados restritos a este dispositivo enquanto não houver servidor.</li>
        </ul>
      </div></section>
    </div>`,
  };

  const desenhar = () => { qs('#painel', tela).innerHTML = paineis[aba](); };

  delegar(tela, 'click', '.aba[data-aba]', (_e, el) => {
    aba = el.dataset.aba;
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    desenhar();
  });

  delegar(tela, 'click', '[data-acao="salvar-escritorio"]', () => {
    const escritorio = { ...db.config().escritorio };
    tela.querySelectorAll('[data-esc]').forEach((el) => { escritorio[el.dataset.esc] = el.value; });
    db.salvarConfig({ escritorio }); aviso('Dados do escritório salvos.', 'ok');
  });
  delegar(tela, 'click', '[data-acao="salvar-alertas"]', () => {
    const alertasPadrao = qs('#alertas', tela).value.split(',').map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x));
    db.salvarConfig({ alertasPadrao, recessoForense: qs('#recesso', tela).checked });
    aviso('Régua de alertas atualizada.', 'ok');
  });
  delegar(tela, 'click', '[data-acao="salvar-cores"]', () => {
    const cores = { ...db.config().cores };
    tela.querySelectorAll('[data-cor]').forEach((el) => { cores[el.dataset.cor] = el.value; });
    db.salvarConfig({ cores }); aviso('Cores atualizadas.', 'ok');
  });
  delegar(tela, 'click', '[data-acao="salvar-automacoes"]', () => {
    const auto = { ...db.config().automacoesWhatsapp };
    tela.querySelectorAll('[data-auto]').forEach((el) => {
      auto[el.dataset.auto] = { ...auto[el.dataset.auto], ativo: el.checked };
    });
    db.salvarConfig({ automacoesWhatsapp: auto }); aviso('Automações atualizadas.', 'ok');
  });
  delegar(tela, 'click', '[data-acao="salvar-integracoes"]', () => {
    const integracoes = JSON.parse(JSON.stringify(db.config().integracoes));
    tela.querySelectorAll('[data-int]').forEach((el) => {
      integracoes[el.dataset.int] = { ...integracoes[el.dataset.int], ativo: el.checked };
    });
    tela.querySelectorAll('[data-int-campo]').forEach((el) => {
      const [chave, campo] = el.dataset.intCampo.split(':');
      integracoes[chave] = { ...integracoes[chave], [campo]: el.value };
    });
    db.salvarConfig({ integracoes }); aviso('Integrações salvas.', 'ok');
  });

  delegar(tela, 'click', '[data-acao="novo-feriado"]', () => {
    modalFormulario({
      titulo: 'Novo feriado', largo: true,
      campos: [
        { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true },
        { nome: 'nome', rotulo: 'Nome', tipo: 'text', obrigatorio: true, largura: 2 },
        { nome: 'abrangencia', rotulo: 'Abrangência', tipo: 'select', vazio: false,
          opcoes: ['nacional', 'estadual', 'municipal', 'tribunal'] },
        { nome: 'uf', rotulo: 'UF', tipo: 'text' },
        { nome: 'municipio', rotulo: 'Município', tipo: 'text' },
        { nome: 'tribunal', rotulo: 'Tribunal', tipo: 'text' },
      ],
      aoSalvar: (d) => { db.inserir('feriados', d, 'Feriado cadastrado'); desenhar(); aviso('Feriado cadastrado.', 'ok'); },
    });
  });
  delegar(tela, 'click', '[data-acao="nova-suspensao"]', () => {
    modalFormulario({
      titulo: 'Nova suspensão de expediente', largo: true,
      campos: [
        { nome: 'inicio', rotulo: 'Início', tipo: 'date', obrigatorio: true },
        { nome: 'fim', rotulo: 'Fim', tipo: 'date', obrigatorio: true },
        { nome: 'descricao', rotulo: 'Descrição', tipo: 'text', obrigatorio: true, largura: 2 },
        { nome: 'abrangencia', rotulo: 'Abrangência', tipo: 'select', vazio: false,
          opcoes: ['nacional', 'estadual', 'municipal', 'tribunal'] },
        { nome: 'uf', rotulo: 'UF', tipo: 'text' },
        { nome: 'tribunal', rotulo: 'Tribunal', tipo: 'text' },
      ],
      valores: { inicio: hoje(), fim: hoje() },
      aoSalvar: (d) => { db.inserir('suspensoes', d, 'Suspensão cadastrada'); desenhar(); aviso('Suspensão cadastrada.', 'ok'); },
    });
  });
  delegar(tela, 'click', '[data-del-feriado]', (_e, el) => { db.remover('feriados', el.dataset.delFeriado); desenhar(); });
  delegar(tela, 'click', '[data-del-susp]', (_e, el) => { db.remover('suspensoes', el.dataset.delSusp); desenhar(); });

  delegar(tela, 'click', '[data-restaurar]', (_e, el) => {
    const [colecao, id] = el.dataset.restaurar.split(':');
    db.restaurar(colecao, id); desenhar(); aviso('Registro restaurado.', 'ok');
  });
  delegar(tela, 'click', '[data-definitivo]', async (_e, el) => {
    const [colecao, id] = el.dataset.definitivo.split(':');
    if (!await confirmar({ titulo: 'Exclusão definitiva',
      mensagem: 'Esta operação é irreversível e o registro não poderá ser recuperado. Confirma?',
      rotuloOk: 'Excluir definitivamente', perigo: true })) return;
    db.removerDefinitivo(colecao, id); desenhar(); aviso('Registro removido definitivamente.', 'atencao');
  });

  delegar(tela, 'click', '[data-acao="demonstracao"]', async (_e, el) => {
    if (!await confirmar({ titulo: 'Carregar dados de demonstração',
      mensagem: 'Serão criados clientes, processos, prazos, tarefas, audiências e publicações '
        + 'de exemplo. Use apenas em ambiente de teste. Confirma?' })) return;
    el.disabled = true;
    const { semear } = await import('../core/seed.js');
    await semear({ forcar: true, criarUsuarios: modoAtual() !== 'servidor' });
    if (modoAtual() === 'servidor') {
      const { enviarFila } = await import('../core/store.js');
      await enviarFila();
      await sincronizarCompleto();
    }
    aviso('Base de demonstração carregada.', 'ok');
    desenhar();
  });

  delegar(tela, 'click', '[data-acao="exportar"]', () => {
    baixarArquivo(`backup-sentinela-${hoje()}.json`, db.exportar(), 'application/json');
    aviso('Backup gerado.', 'ok');
  });
  delegar(tela, 'click', '[data-acao="importar"]', () => {
    const input = h('<input type="file" accept="application/json" class="oculto">');
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      const substituir = await confirmar({ titulo: 'Importar backup',
        mensagem: 'Substituir toda a base atual? Escolher "Cancelar" mescla os registros ausentes.',
        rotuloOk: 'Substituir tudo', perigo: true });
      db.importar(await f.text(), { substituir });
      aviso('Backup importado.', 'ok'); input.remove(); location.reload();
    });
    input.click();
  });
  delegar(tela, 'click', '[data-acao="zerar"]', async () => {
    if (!await confirmar({ titulo: 'Apagar todos os dados',
      mensagem: 'Todos os cadastros deste navegador serão removidos, sem possibilidade de recuperação. '
        + 'Exporte um backup antes. Confirma?', rotuloOk: 'Apagar tudo', perigo: true })) return;
    db.zerar(); location.reload();
  });

  desenhar();
  return tela;
}
