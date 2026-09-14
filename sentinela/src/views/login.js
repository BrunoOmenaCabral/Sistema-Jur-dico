// Tela de acesso.

import { h, qs, esc, aviso } from '../ui/ui.js';
import { autenticar } from '../core/auth.js';
import { db, modoAtual } from '../core/store.js';

export function telaLogin(aoEntrar) {
  const tela = h(`<div class="login">
    <form class="login__cartao">
      <div class="login__marca">
        <div style="font-size:2rem">⚖️</div>
        <strong>SENTINELA</strong>
        <span>Gestão jurídica — nenhum prazo passa despercebido</span>
      </div>
      <div id="erro"></div>
      <div class="form">
        <div class="campo"><label for="email">E-mail</label>
          <input id="email" type="email" autocomplete="username" required></div>
        <div class="campo"><label for="senha">Senha</label>
          <input id="senha" type="password" autocomplete="current-password" required></div>
        <button class="btn btn--primario btn--bloco" type="submit">Entrar</button>
      </div>
      <div class="mini mudo centro" style="margin-top:1rem" id="rodape-login"></div>
    </form>
  </div>`);

  // A dica de acesso só faz sentido na base de demonstração local.
  qs('#rodape-login', tela).innerHTML = modoAtual() === 'servidor'
    ? 'Acesso restrito aos usuários cadastrados pelo administrador do escritório.'
    : 'Acesso de demonstração: <span class="mono">admin@escritorio.adv.br</span> / <span class="mono">sentinela</span>';

  tela.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const botao = tela.querySelector('button[type=submit]');
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      await autenticar(qs('#email', tela).value, qs('#senha', tela).value);
      db.backupAutomatico();
      await aoEntrar();
    } catch (e) {
      const botao = tela.querySelector('button[type=submit]');
      botao.disabled = false;
      botao.textContent = 'Entrar';
      qs('#erro', tela).innerHTML = `<div class="aviso aviso--alerta">${esc(e.message)}</div>`;
    }
  });

  document.body.innerHTML = '';
  document.body.appendChild(tela);
  return tela;
}
