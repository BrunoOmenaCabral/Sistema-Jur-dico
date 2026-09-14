// Usuários e permissões.

import { h, qs, esc, delegar, aviso, confirmar } from '../ui/ui.js';
import { modalFormulario } from '../ui/formulario.js';
import { cabecalhoPagina } from '../ui/componentes.js';
import { db } from '../core/store.js';
import { PERFIS, criarUsuario, definirSenha, usuarioAtual, pode } from '../core/auth.js';
import { fmtDataHora } from '../core/util.js';
import { definirTitulo } from '../ui/casca.js';

export function usuarios() {
  definirTitulo('Usuários');
  if (!pode('usuarios:ver')) return '<div class="aviso aviso--alerta">Acesso restrito ao administrador.</div>';

  const tela = h(`<div>
    ${cabecalhoPagina('Usuários e permissões', '<button class="btn btn--primario" data-acao="novo">Novo usuário</button>')}
    <div class="cartao"><div class="cartao__corpo cartao__corpo--liso tabela--rolagem" id="lista"></div></div>
    <section class="cartao" style="margin-top:.8rem"><div class="cartao__corpo">
      <h3>Perfis</h3>
      <dl class="chave-valor" style="margin-top:.5rem">
        ${Object.entries(PERFIS).map(([k, p]) => `<dt>${esc(p.rotulo)}</dt><dd>${esc(p.descricao)}</dd>`).join('')}
      </dl>
    </div></section>
  </div>`);

  const desenhar = () => {
    const lista = db.listar('usuarios');
    qs('#lista', tela).innerHTML = `<table class="tabela">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>OAB</th><th>Último acesso</th><th></th></tr></thead>
      <tbody>${lista.map((u) => `<tr>
        <td>${esc(u.nome)}</td><td>${esc(u.email)}</td>
        <td><span class="selo">${esc(PERFIS[u.perfil]?.rotulo || u.perfil)}</span></td>
        <td>${esc(u.oab || '—')}</td>
        <td>${esc(fmtDataHora(u.ultimoAcesso))}</td>
        <td class="linha">
          <button class="btn btn--pequeno" data-senha="${u.id}">Senha</button>
          <button class="btn btn--pequeno" data-editar="${u.id}">Editar</button>
          ${u.id === usuarioAtual()?.id ? ''
    : `<button class="btn btn--pequeno ${u.ativo === false ? '' : 'btn--perigo'}" data-ativar="${u.id}">
        ${u.ativo === false ? 'Reativar' : 'Desativar'}</button>`}
        </td></tr>`).join('')}</tbody></table>`;
  };

  delegar(tela, 'click', '[data-acao="novo"]', () => {
    modalFormulario({
      titulo: 'Novo usuário', largo: true,
      campos: [
        { nome: 'nome', rotulo: 'Nome', tipo: 'text', obrigatorio: true, largura: 2 },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true },
        { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', vazio: false, obrigatorio: true,
          opcoes: Object.entries(PERFIS).map(([k, p]) => ({ valor: k, rotulo: p.rotulo })) },
        { nome: 'oab', rotulo: 'OAB', tipo: 'text' },
        { nome: 'senha', rotulo: 'Senha inicial', tipo: 'text', obrigatorio: true },
      ],
      rotuloSalvar: 'Criar usuário',
      aoSalvar: async (d, ctx) => {
        try { await criarUsuario(d); aviso('Usuário criado.', 'ok'); desenhar(); }
        catch (e) { ctx.avisos.innerHTML = `<div class="aviso aviso--alerta">${esc(e.message)}</div>`; return false; }
      },
    });
  });

  delegar(tela, 'click', '[data-editar]', (_e, el) => {
    const u = db.obter('usuarios', el.dataset.editar);
    modalFormulario({
      titulo: 'Editar usuário', largo: true,
      campos: [
        { nome: 'nome', rotulo: 'Nome', tipo: 'text', obrigatorio: true, largura: 2 },
        { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', vazio: false,
          opcoes: Object.entries(PERFIS).map(([k, p]) => ({ valor: k, rotulo: p.rotulo })) },
        { nome: 'oab', rotulo: 'OAB', tipo: 'text' },
        { nome: 'permissoesTexto', rotulo: 'Permissões individuais', tipo: 'text', largura: 2,
          ajuda: 'Opcional. Sobrepõe o perfil. Ex.: prazos:*, processos:ver' },
      ],
      valores: { ...u, permissoesTexto: (u.permissoes || []).join(', ') },
      aoSalvar: (d) => {
        const permissoes = String(d.permissoesTexto || '').split(',').map((x) => x.trim()).filter(Boolean);
        db.atualizar('usuarios', u.id, { nome: d.nome, perfil: d.perfil, oab: d.oab,
          permissoes: permissoes.length ? permissoes : null }, 'Usuário alterado');
        aviso('Usuário atualizado.', 'ok'); desenhar();
      },
    });
  });

  delegar(tela, 'click', '[data-senha]', (_e, el) => {
    modalFormulario({
      titulo: 'Definir senha',
      campos: [{ nome: 'senha', rotulo: 'Nova senha', tipo: 'text', obrigatorio: true }],
      aoSalvar: async ({ senha }) => { await definirSenha(el.dataset.senha, senha); aviso('Senha alterada.', 'ok'); },
    });
  });

  delegar(tela, 'click', '[data-ativar]', async (_e, el) => {
    const u = db.obter('usuarios', el.dataset.ativar);
    const desativar = u.ativo !== false;
    if (desativar && !await confirmar({ titulo: 'Desativar usuário',
      mensagem: `${u.nome} perderá acesso ao sistema. Os registros permanecem vinculados. Confirma?`, perigo: true })) return;
    db.atualizar('usuarios', u.id, { ativo: !desativar }, desativar ? 'Usuário desativado' : 'Usuário reativado');
    desenhar();
  });

  desenhar();
  return tela;
}
