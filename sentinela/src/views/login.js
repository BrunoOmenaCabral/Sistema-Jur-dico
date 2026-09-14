// Tela de acesso: entrada e criação de conta.

import { h, qs, esc, delegar } from '../ui/ui.js';
import { autenticar, registrarConta } from '../core/auth.js';
import { db, modoAtual } from '../core/store.js';
import { MARCA, ASSINATURA } from '../core/marca.js';

export function telaLogin(aoEntrar) {
  const servidor = modoAtual() === 'servidor';
  // Base ainda sem nenhuma conta: não há o que oferecer além do cadastro.
  const baseVazia = !servidor && db.listar('usuarios').length === 0;

  const tela = h(`<div class="login">
    <form class="login__cartao">
      <div class="login__marca">
        <div style="font-size:2rem">⚖️</div>
        <strong>${esc(MARCA)}</strong>
        <span>${esc(ASSINATURA)}</span>
      </div>

      ${servidor ? '' : `<div class="abas abas--login">
        <div class="aba ${baseVazia ? '' : 'ativa'}" data-modo="entrar">Entrar</div>
        <div class="aba ${baseVazia ? 'ativa' : ''}" data-modo="criar">Criar conta</div>
      </div>`}

      <div id="erro"></div>
      <div class="form" id="campos"></div>
      <button class="btn btn--primario btn--bloco" type="submit" id="acao">Entrar</button>
      <div class="mini mudo centro" style="margin-top:1rem" id="rodape-login"></div>
    </form>
  </div>`);

  let modo = baseVazia ? 'criar' : 'entrar';

  const CAMPOS = {
    entrar: `
      <div class="campo"><label for="email">E-mail</label>
        <input id="email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="senha">Senha</label>
        <input id="senha" type="password" autocomplete="current-password" required></div>`,
    criar: `
      <div class="campo"><label for="nome">Nome completo</label>
        <input id="nome" type="text" autocomplete="name" required></div>
      <div class="campo"><label for="oab">OAB <span class="mudo">(opcional)</span></label>
        <input id="oab" type="text" placeholder="Ex.: 12345/PE"></div>
      <div class="campo"><label for="email">E-mail</label>
        <input id="email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="senha">Senha</label>
        <input id="senha" type="password" autocomplete="new-password" required>
        <span class="campo__ajuda">Mínimo de 8 caracteres.</span></div>
      <div class="campo"><label for="senha2">Repita a senha</label>
        <input id="senha2" type="password" autocomplete="new-password" required></div>`,
  };

  const RODAPE = {
    entrar: servidor
      ? 'Acesso restrito aos usuários cadastrados pelo administrador do escritório.'
      : 'Informe as credenciais da conta criada neste navegador.',
    criar: 'A conta e os dados ficam neste navegador, sob seu controle exclusivo. '
      + 'Nada é enviado a servidor algum.',
  };

  const desenhar = () => {
    qs('#campos', tela).innerHTML = CAMPOS[modo];
    qs('#acao', tela).textContent = modo === 'entrar' ? 'Entrar' : 'Criar conta e entrar';
    qs('#rodape-login', tela).innerHTML = RODAPE[modo];
    qs('#erro', tela).innerHTML = '';
  };

  delegar(tela, 'click', '.aba[data-modo]', (_ev, el) => {
    modo = el.dataset.modo;
    tela.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === el));
    desenhar();
  });

  tela.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = qs('#acao', tela);
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = modo === 'entrar' ? 'Entrando…' : 'Criando conta…';
    try {
      if (modo === 'criar') {
        const senha = qs('#senha', tela).value;
        if (senha !== qs('#senha2', tela).value) throw new Error('As senhas não coincidem.');
        await registrarConta({
          nome: qs('#nome', tela).value,
          email: qs('#email', tela).value,
          senha,
          oab: qs('#oab', tela).value,
        });
      } else {
        await autenticar(qs('#email', tela).value, qs('#senha', tela).value);
      }
      db.backupAutomatico();
      await aoEntrar({ novaConta: modo === 'criar' });
    } catch (e) {
      botao.disabled = false;
      botao.textContent = rotulo;
      qs('#erro', tela).innerHTML = `<div class="aviso aviso--alerta">${esc(e.message)}</div>`;
    }
  });

  if (baseVazia) {
    qs('#campos', tela).insertAdjacentHTML('beforebegin',
      '<div class="aviso aviso--info">Nenhuma conta cadastrada neste navegador. Crie a sua para começar.</div>');
  }

  desenhar();
  document.body.innerHTML = '';
  document.body.appendChild(tela);
  return tela;
}
