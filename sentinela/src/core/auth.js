// Autenticação e controle de acesso.
//
// Com backend, tudo o que é sensível acontece no servidor: a senha é conferida
// lá (scrypt com sal), e a sessão vem em cookie httpOnly que o JavaScript não
// consegue ler. Sem backend, o modo local confere um hash SHA-256 com sal
// guardado no próprio navegador — suficiente para demonstração, não para uso
// compartilhado.

import { db, sessao, modoAtual } from './store.js';
import { api } from './api.js';
import { norm, uid } from './util.js';
import { PERFIS, temPermissao } from './perfis.js';

export { PERFIS };

export async function hashSenha(senha, sal) {
  const dados = new TextEncoder().encode(`${sal}::${senha}`);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function criarUsuario({ nome, email, senha, perfil = 'advogado', oab = '', permissoes = null }) {
  if (modoAtual() === 'servidor') {
    const { usuario } = await api.criarUsuario({ nome, email, senha, perfil, oab, permissoes });
    const { sincronizarIncremental } = await import('./store.js');
    await sincronizarIncremental();
    return usuario;
  }
  if (db.listar('usuarios').some((u) => norm(u.email) === norm(email))) {
    throw new Error('Já existe usuário com este e-mail.');
  }
  const sal = uid('sal');
  return db.inserir('usuarios', {
    nome, email: String(email).toLowerCase(), perfil, oab, sal,
    senhaHash: await hashSenha(senha, sal),
    permissoes, ativo: true,
  }, `Usuário ${nome} criado`);
}

/**
 * Criação de conta pela própria pessoa.
 *
 * Só existe no modo local, em que a base vive no navegador de quem usa e não
 * há dado de terceiro exposto. Como essa base é inteiramente do próprio
 * usuário, a conta criada administra o escritório dele. Havendo backend, o
 * cadastro continua sendo ato do administrador, que responde pelo acesso de
 * cada pessoa aos processos do escritório.
 */
export async function registrarConta({ nome, email, senha, oab = '' }) {
  if (modoAtual() === 'servidor') {
    throw new Error('Neste servidor as contas são criadas pelo administrador do escritório.');
  }
  const limpo = String(email || '').trim().toLowerCase();
  if (!String(nome || '').trim()) throw new Error('Informe o nome completo.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo)) throw new Error('Informe um e-mail válido.');
  if (String(senha || '').length < 8) throw new Error('A senha deve ter ao menos 8 caracteres.');
  if (db.listar('usuarios').some((u) => norm(u.email) === norm(limpo))) {
    throw new Error('Já existe conta cadastrada com este e-mail.');
  }
  const usuario = await criarUsuario({
    nome: String(nome).trim(), email: limpo, senha, oab, perfil: 'admin',
  });

  // Sem servidor não há e-mail de recuperação. O código entregue agora é o
  // único caminho de volta se a senha for esquecida.
  const codigo = gerarCodigoRecuperacao();
  const salCodigo = uid('sal');
  db.atualizar('usuarios', usuario.id, {
    salCodigo, codigoRecuperacaoHash: await hashSenha(normalizarCodigo(codigo), salCodigo),
  }, 'Código de recuperação gerado');

  await autenticar(limpo, senha);
  return { ...db.obter('usuarios', usuario.id), codigoRecuperacao: codigo };
}

/* ------------------------------------------------- código de recuperação -- */

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0 e 1

/** Código legível, para quem precisa copiar à mão de um papel. */
export function gerarCodigoRecuperacao() {
  const sorteio = crypto.getRandomValues(new Uint8Array(16));
  const letras = [...sorteio].map((n) => ALFABETO[n % ALFABETO.length]).join('');
  return letras.match(/.{4}/g).join('-');
}

const normalizarCodigo = (codigo) => String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* -------------------------------------------------- alteração de acesso -- */

/**
 * Troca o e-mail de acesso, a senha, ou ambos.
 *
 * A senha atual é sempre exigida de quem altera o próprio acesso. Sessão
 * esquecida aberta não deve bastar para tomar a conta.
 */
export async function alterarAcesso({ email, senhaAtual, senhaNova }) {
  const atual = usuarioAtual();
  if (!atual) throw new Error('Sessão não encontrada.');
  if (senhaNova && String(senhaNova).length < 8) {
    throw new Error('A nova senha deve ter ao menos 8 caracteres.');
  }

  if (modoAtual() === 'servidor') {
    const r = await api.alterarAcesso(atual.id, { email, senhaAtual, senhaNova });
    const { sincronizarIncremental } = await import('./store.js');
    await sincronizarIncremental();
    return r.usuario;
  }

  const registro = db.obter('usuarios', atual.id);
  if (!registro) throw new Error('Usuário não encontrado.');
  const confere = await hashSenha(String(senhaAtual || ''), registro.sal);
  if (confere !== registro.senhaHash) throw new Error('Senha atual incorreta.');

  const mudancas = {};
  const limpo = String(email || '').trim().toLowerCase();
  if (limpo && limpo !== norm(registro.email)) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo)) throw new Error('Informe um e-mail válido.');
    if (db.listar('usuarios').some((u) => u.id !== registro.id && norm(u.email) === norm(limpo))) {
      throw new Error('Já existe conta com este e-mail.');
    }
    mudancas.email = limpo;
  }
  if (senhaNova) {
    const sal = uid('sal');
    mudancas.sal = sal;
    mudancas.senhaHash = await hashSenha(senhaNova, sal);
  }
  if (!Object.keys(mudancas).length) return registro;

  const atualizado = db.atualizar('usuarios', registro.id, mudancas,
    [mudancas.email ? 'E-mail de acesso alterado' : null, mudancas.senhaHash ? 'Senha alterada' : null]
      .filter(Boolean).join(' · '));
  sessao.definir({ ...sessao.obter(), nome: atualizado.nome, perfil: atualizado.perfil });
  return atualizado;
}

/* ------------------------------------------------------- esqueci a senha -- */

/**
 * Pede a redefinição por e-mail. Só existe com backend: página estática não
 * envia e-mail, e fingir que envia seria pior do que dizer que não envia.
 */
export async function pedirRecuperacao(email) {
  if (modoAtual() !== 'servidor') {
    throw new Error('Sem servidor não há como enviar e-mail. Use o código de recuperação '
      + 'gerado quando a conta foi criada.');
  }
  return api.recuperar(email);
}

/** Conclui a redefinição aberta pelo link recebido por e-mail. */
export async function confirmarRecuperacao(token, senha) {
  if (String(senha || '').length < 8) throw new Error('A senha deve ter ao menos 8 caracteres.');
  return api.confirmarRecuperacao(token, senha);
}

/**
 * Redefinição no modo local, pelo código entregue na criação da conta.
 *
 * Vale registrar o limite: no modo local a base inteira vive no navegador de
 * quem usa, legível por quem tiver o aparelho. A senha resguarda de acesso
 * casual, não de quem senta na máquina. Proteção real de acesso é atributo do
 * modo servidor.
 */
export async function recuperarComCodigo(email, codigo, senhaNova) {
  if (modoAtual() === 'servidor') throw new Error('Neste servidor a redefinição é por e-mail.');
  if (String(senhaNova || '').length < 8) throw new Error('A senha deve ter ao menos 8 caracteres.');

  const u = db.listar('usuarios').find((x) => norm(x.email) === norm(email));
  if (!u) throw new Error('Não há conta com este e-mail neste navegador.');
  if (!u.codigoRecuperacaoHash) throw new Error('Esta conta não possui código de recuperação.');

  const confere = await hashSenha(normalizarCodigo(codigo), u.salCodigo);
  if (confere !== u.codigoRecuperacaoHash) throw new Error('Código de recuperação incorreto.');

  const sal = uid('sal');
  db.atualizar('usuarios', u.id, {
    sal, senhaHash: await hashSenha(senhaNova, sal),
  }, 'Senha redefinida por código de recuperação');
  return autenticar(email, senhaNova);
}

export async function definirSenha(usuarioId, senha) {
  if (modoAtual() === 'servidor') return api.definirSenha(usuarioId, senha);
  const sal = uid('sal');
  return db.atualizar('usuarios', usuarioId,
    { sal, senhaHash: await hashSenha(senha, sal) }, 'Senha alterada');
}

export async function autenticar(email, senha) {
  if (modoAtual() === 'servidor') {
    const { usuario } = await api.entrar(email, senha);
    sessao.definir({ usuarioId: usuario.id, nome: usuario.nome, perfil: usuario.perfil,
      em: new Date().toISOString() });
    return usuario;
  }
  const u = db.listar('usuarios').find((x) => norm(x.email) === norm(email));
  if (!u || u.ativo === false) throw new Error('Usuário não encontrado ou inativo.');
  const hash = await hashSenha(senha, u.sal);
  if (hash !== u.senhaHash) throw new Error('Credenciais inválidas.');
  sessao.definir({ usuarioId: u.id, nome: u.nome, perfil: u.perfil, em: new Date().toISOString() });
  db.atualizar('usuarios', u.id, { ultimoAcesso: new Date().toISOString() }, 'Acesso ao sistema');
  return u;
}

export const usuarioAtual = () => {
  const s = sessao.obter();
  if (!s) return null;
  // Antes da primeira sincronização, a sessão já basta para liberar a interface.
  return db.obter('usuarios', s.usuarioId)
    || { id: s.usuarioId, nome: s.nome, perfil: s.perfil, email: s.email || '' };
};

export function sair() {
  if (modoAtual() === 'servidor') api.sair().catch(() => {});
  sessao.limpar();
}

/** Verifica permissão no formato "modulo:acao" para o usuário da sessão. */
export const pode = (acao, usuario = usuarioAtual()) => temPermissao(usuario, acao);

export const exigir = (acao) => {
  if (!pode(acao)) throw new Error('Você não possui permissão para esta operação.');
};
