// Tela de acesso: entrada, criação de conta e redefinição de senha.

import { h, qs, esc, delegar, modal } from '../ui/ui.js';
import {
  autenticar, registrarConta, pedirRecuperacao, recuperarComCodigo, confirmarRecuperacao,
} from '../core/auth.js';
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
      <div class="mini centro" style="margin-top:.8rem">
        <a href="#" id="link-recuperar">Esqueci minha senha</a>
      </div>
      <div class="mini mudo centro" style="margin-top:.6rem" id="rodape-login"></div>
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
    recuperar: servidor ? `
      <div class="campo"><label for="email">E-mail da conta</label>
        <input id="email" type="email" autocomplete="username" required>
        <span class="campo__ajuda">Enviaremos um link de redefinição para esse endereço.</span></div>`
      : `
      <div class="campo"><label for="email">E-mail da conta</label>
        <input id="email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="codigo">Código de recuperação</label>
        <input id="codigo" type="text" placeholder="XXXX-XXXX-XXXX-XXXX" required>
        <span class="campo__ajuda">Entregue quando a conta foi criada.</span></div>
      <div class="campo"><label for="senha">Nova senha</label>
        <input id="senha" type="password" autocomplete="new-password" required></div>`,
  };

  const RODAPE = {
    entrar: servidor
      ? 'Acesso restrito aos usuários cadastrados pelo administrador do escritório.'
      : 'Informe as credenciais da conta criada neste navegador.',
    criar: 'A conta e os dados ficam neste navegador, sob seu controle exclusivo. '
      + 'Nada é enviado a servidor algum.',
    recuperar: servidor
      ? 'O link vale por tempo limitado e só pode ser usado uma vez.'
      : 'Sem servidor não há e-mail a enviar: a redefinição usa o código guardado por você.',
  };

  const ROTULOS = { entrar: 'Entrar', criar: 'Criar conta e entrar', recuperar: 'Redefinir senha' };

  const desenhar = () => {
    qs('#campos', tela).innerHTML = CAMPOS[modo];
    qs('#acao', tela).textContent = ROTULOS[modo];
    qs('#rodape-login', tela).innerHTML = RODAPE[modo];
    qs('#erro', tela).innerHTML = '';
    qs('#link-recuperar', tela).textContent = modo === 'recuperar' ? 'Voltar ao acesso' : 'Esqueci minha senha';
    tela.querySelectorAll('.aba[data-modo]').forEach((a) => a.classList.toggle('ativa', a.dataset.modo === modo));
  };

  const erro = (mensagem) => {
    qs('#erro', tela).innerHTML = `<div class="aviso aviso--alerta quebra">${esc(mensagem)}</div>`;
  };

  delegar(tela, 'click', '.aba[data-modo]', (_ev, el) => { modo = el.dataset.modo; desenhar(); });
  qs('#link-recuperar', tela).addEventListener('click', (ev) => {
    ev.preventDefault();
    modo = modo === 'recuperar' ? 'entrar' : 'recuperar';
    desenhar();
  });

  tela.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = qs('#acao', tela);
    botao.disabled = true;
    botao.textContent = 'Aguarde…';
    try {
      if (modo === 'recuperar') return await tratarRecuperacao();
      if (modo === 'criar') {
        const senha = qs('#senha', tela).value;
        if (senha !== qs('#senha2', tela).value) throw new Error('As senhas não coincidem.');
        const conta = await registrarConta({
          nome: qs('#nome', tela).value,
          email: qs('#email', tela).value,
          senha,
          oab: qs('#oab', tela).value,
        });
        db.backupAutomatico();
        if (conta.codigoRecuperacao) await mostrarCodigo(conta.codigoRecuperacao);
        return await aoEntrar({ novaConta: true });
      }
      await autenticar(qs('#email', tela).value, qs('#senha', tela).value);
      db.backupAutomatico();
      return await aoEntrar({ novaConta: false });
    } catch (e) {
      erro(e.message);
      return undefined;
    } finally {
      botao.disabled = false;
      botao.textContent = ROTULOS[modo];
    }
  });

  /** Com servidor, pede o e-mail. Sem servidor, redefine pelo código. */
  async function tratarRecuperacao() {
    if (servidor) {
      const r = await pedirRecuperacao(qs('#email', tela).value);
      qs('#erro', tela).innerHTML = `<div class="aviso aviso--ok quebra">${esc(r.mensagem)}</div>`
        + (r.emailConfigurado === false
          ? '<div class="aviso aviso--atencao quebra">O servidor ainda não tem provedor de e-mail '
            + 'configurado. Peça ao administrador o link registrado no console do servidor.</div>'
          : '');
      return undefined;
    }
    await recuperarComCodigo(
      qs('#email', tela).value, qs('#codigo', tela).value, qs('#senha', tela).value,
    );
    db.backupAutomatico();
    return aoEntrar({ novaConta: false });
  }

  if (baseVazia) {
    qs('#campos', tela).insertAdjacentHTML('beforebegin',
      '<div class="aviso aviso--info">Nenhuma conta cadastrada neste navegador. Crie a sua para começar.</div>');
  }

  desenhar();
  document.body.innerHTML = '';
  document.body.appendChild(tela);
  return tela;
}

/**
 * Mostra o código de recuperação uma única vez.
 *
 * Sem servidor não existe e-mail de redefinição, então este código é o único
 * caminho de volta. Guardá-lo é responsabilidade de quem cria a conta, e a
 * tela não avança enquanto ele não for reconhecido.
 */
function mostrarCodigo(codigo) {
  return new Promise((resolve) => {
    modal({
      titulo: 'Guarde seu código de recuperação',
      conteudo: `<div class="pilha">
        <p class="quebra">Este código redefine sua senha caso você a esqueça. Ele aparece
          uma única vez e não fica legível em lugar algum depois daqui.</p>
        <div class="codigo-recuperacao mono">${esc(codigo)}</div>
        <p class="mini mudo quebra">Sem servidor, não há e-mail a enviar: a base vive neste
          navegador. Anote o código em lugar seguro, fora do computador.</p>
      </div>`,
      acoes: [
        { rotulo: 'Copiar', aoClicar: () => navigator.clipboard?.writeText(codigo).catch(() => {}) },
        { rotulo: 'Guardei o código', classe: 'btn--primario',
          aoClicar: (fechar) => { fechar(); resolve(); } },
      ],
    });
  });
}

/**
 * Tela aberta pelo link recebido por e-mail. Não exige sessão, porque quem a
 * usa é justamente quem não consegue entrar.
 */
export function telaRedefinicao(token, aoConcluir) {
  const tela = h(`<div class="login">
    <form class="login__cartao">
      <div class="login__marca">
        <div style="font-size:2rem">⚖️</div>
        <strong>${esc(MARCA)}</strong>
        <span>Definir nova senha</span>
      </div>
      <div id="erro"></div>
      <div class="form">
        <div class="campo"><label for="senha">Nova senha</label>
          <input id="senha" type="password" autocomplete="new-password" required>
          <span class="campo__ajuda">Mínimo de 8 caracteres.</span></div>
        <div class="campo"><label for="senha2">Repita a senha</label>
          <input id="senha2" type="password" autocomplete="new-password" required></div>
      </div>
      <button class="btn btn--primario btn--bloco" type="submit">Salvar nova senha</button>
    </form>
  </div>`);

  tela.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = tela.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const senha = qs('#senha', tela).value;
      if (senha !== qs('#senha2', tela).value) throw new Error('As senhas não coincidem.');
      await confirmarRecuperacao(token, senha);
      location.hash = '';
      aoConcluir?.();
    } catch (e) {
      qs('#erro', tela).innerHTML = `<div class="aviso aviso--alerta quebra">${esc(e.message)}</div>`;
      botao.disabled = false;
    }
  });

  document.body.innerHTML = '';
  document.body.appendChild(tela);
  return tela;
}
