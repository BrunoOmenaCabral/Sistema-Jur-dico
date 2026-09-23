// Regras do servidor: autenticação, autorização, validação das gravações,
// auditoria e montagem do estado enviado ao navegador.

import { randomUUID, createHash } from 'node:crypto';
import { banco, bancoDa, COLECOES, CONTA_INICIAL } from './banco.js';
import { config } from './config.js';
import { gerarHashSenha, senhaConfere } from './sessao.js';
import {
  PERFIS, temPermissao, MODULO_DA_COLECAO, ACAO_DA_OPERACAO,
} from '../../sentinela/src/core/perfis.js';

const agora = () => new Date().toISOString();
const normalizar = (s) => String(s ?? '').trim().toLowerCase();
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export class ErroDeUso extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

/* ------------------------------------------------------------- usuários -- */

/** Remove qualquer dado sensível antes de enviar o usuário ao navegador. */
export const publicarUsuario = (u) => {
  if (!u) return null;
  const { senhaHash, sal, ...limpo } = u;
  return limpo;
};

/**
 * Acesso pelo e-mail, que é único em todo o servidor.
 *
 * É por ele que se descobre a conta de quem está entrando: o usuário não
 * informa a qual escritório pertence, o servidor é que sabe.
 */
export async function usuarioPorEmail(email) {
  const acesso = await banco.acessoPorEmail(email);
  if (!acesso) return null;
  return banco.obter(acesso.contaId, 'usuarios', acesso.usuarioId);
}

export const usuarioPorId = (contaId, id) => bancoDa(contaId).obter('usuarios', id);

/**
 * Cria a conta do escritório com o seu primeiro acesso.
 *
 * É o cadastro que qualquer pessoa faz sozinha: conta nova, usuário
 * administrador e configurações próprias. Nada é compartilhado com outra conta.
 */
export async function criarConta({ nome, email, senha, escritorio = '' }) {
  if (!nome || !email || !senha) throw new ErroDeUso('Informe nome, e-mail e senha.');
  if (String(senha).length < 8) throw new ErroDeUso('A senha deve ter ao menos 8 caracteres.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    throw new ErroDeUso('Informe um e-mail válido.');
  }
  if (await usuarioPorEmail(email)) throw new ErroDeUso('Já existe conta com este e-mail.', 409);

  const contaId = `cta_${randomUUID().slice(0, 12)}`;
  await banco.criarConta(contaId, escritorio || nome);

  const { configuracoesPadrao } = await import('./padroes.js');
  const padrao = configuracoesPadrao();
  await bancoDa(contaId).salvarConfiguracoes({
    ...padrao,
    escritorio: { ...padrao.escritorio, nome: escritorio || `Escritório de ${nome}`, email },
  });

  const usuario = await criarUsuario({ nome, email, senha, perfil: 'admin' }, null, contaId);
  return { contaId, usuario };
}

export async function criarUsuario({ nome, email, senha, perfil = 'advogado', oab = '', permissoes = null },
  autor = null, contaId = null) {
  const conta = contaId || autor?.contaId;
  if (!conta) throw new ErroDeUso('Operação sem conta definida.', 400);
  if (!nome || !email || !senha) throw new ErroDeUso('Informe nome, e-mail e senha.');
  if (String(senha).length < 8) throw new ErroDeUso('A senha deve ter ao menos 8 caracteres.');
  if (!PERFIS[perfil]) throw new ErroDeUso('Perfil inválido.');
  if (await usuarioPorEmail(email)) throw new ErroDeUso('Já existe usuário com este e-mail.');

  const usuario = {
    id: `usu_${randomUUID().slice(0, 12)}`,
    contaId: conta,
    nome, email: normalizar(email), perfil, oab, permissoes, ativo: true,
    criadoEm: agora(), criadoPor: autor?.id || null, atualizadoEm: agora(),
  };
  await bancoDa(conta).gravar('usuarios', usuario);
  const { hash, sal } = gerarHashSenha(senha);
  await banco.salvarCredencial(usuario.id, hash, sal);
  await auditarNaConta(conta, autor, 'usuarios', usuario.id, 'criou', `Usuário ${nome} criado`,
    null, publicarUsuario(usuario));
  return publicarUsuario(usuario);
}

export async function definirSenha(contaId, usuarioId, senha, autor = null) {
  if (String(senha || '').length < 8) throw new ErroDeUso('A senha deve ter ao menos 8 caracteres.');
  const u = await usuarioPorId(contaId, usuarioId);
  if (!u) throw new ErroDeUso('Usuário não encontrado.', 404);
  const { hash, sal } = gerarHashSenha(senha);
  await banco.salvarCredencial(usuarioId, hash, sal);
  await auditarNaConta(contaId, autor, 'usuarios', usuarioId, 'alterou', 'Senha alterada');
  return { ok: true };
}

export async function autenticar(email, senha) {
  const u = await usuarioPorEmail(email);
  if (!u || u.ativo === false || u.excluidoEm) throw new ErroDeUso('Credenciais inválidas.', 401);
  const cred = await banco.credencial(u.id);
  if (!cred || !senhaConfere(senha, cred.hash, cred.sal)) throw new ErroDeUso('Credenciais inválidas.', 401);
  const bd = bancoDa(u.contaId);
  await bd.gravar('usuarios', { ...u, ultimoAcesso: agora(), atualizadoEm: agora() });
  await auditarNaConta(u.contaId, u, 'usuarios', u.id, 'acessou', 'Acesso ao sistema');
  return publicarUsuario(await bd.obter('usuarios', u.id));
}

/**
 * Alteração do próprio acesso: e-mail e senha.
 *
 * A senha atual é exigida de quem altera o próprio acesso, para que sessão
 * esquecida em máquina alheia não sirva para tomar a conta. O administrador
 * altera o de terceiros sem ela, porque já responde por isso.
 */
export async function alterarAcesso(usuarioId, { email, senhaAtual, senhaNova }, autor) {
  const u = await usuarioPorId(autor.contaId, usuarioId);
  if (!u) throw new ErroDeUso('Usuário não encontrado.', 404);

  const proprio = autor?.id === usuarioId;
  if (!proprio && autor?.perfil !== 'admin') {
    throw new ErroDeUso('Só o administrador altera o acesso de outro usuário.', 403);
  }
  if (proprio) {
    const cred = await banco.credencial(usuarioId);
    if (!cred || !senhaConfere(String(senhaAtual || ''), cred.hash, cred.sal)) {
      throw new ErroDeUso('Senha atual incorreta.', 401);
    }
  }

  const mudancas = {};
  if (email && normalizar(email) !== normalizar(u.email)) {
    const ocupado = await usuarioPorEmail(email);
    if (ocupado && ocupado.id !== usuarioId) throw new ErroDeUso('Já existe usuário com este e-mail.');
    mudancas.email = normalizar(email);
  }
  if (Object.keys(mudancas).length) {
    const antes = publicarUsuario(u);
    await bancoDa(autor.contaId).gravar('usuarios', { ...u, ...mudancas, atualizadoEm: agora() });
    await auditar(autor, 'usuarios', usuarioId, 'alterou', 'E-mail de acesso alterado',
      antes, publicarUsuario(await bancoDa(autor.contaId).obter('usuarios', usuarioId)));
  }
  if (senhaNova) await definirSenha(autor.contaId, usuarioId, senhaNova, autor);

  return { usuario: publicarUsuario(await bancoDa(autor.contaId).obter('usuarios', usuarioId)) };
}

/* -------------------------------------------------------- recuperação ---- */

const resumoToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Abre um pedido de redefinição de senha.
 *
 * Devolve sempre a mesma coisa a quem chamou, exista ou não conta com o
 * e-mail informado: dizer que o endereço não está cadastrado entregaria, a
 * qualquer curioso, a lista de quem trabalha no escritório.
 */
export async function solicitarRecuperacao(email) {
  await banco.limparRecuperacoesVencidas();
  const u = await usuarioPorEmail(email);
  if (!u || u.ativo === false || u.excluidoEm) return { token: null, usuario: null };

  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const expira = new Date(Date.now() + config.minutosRecuperacao * 60000).toISOString();
  await banco.salvarRecuperacao(resumoToken(token), u.id, u.contaId, expira);
  await auditar(u, 'usuarios', u.id, 'solicitou', 'Redefinição de senha solicitada');
  return { token, usuario: publicarUsuario(u), expira };
}

/** Conclui a redefinição. O token vale uma vez e dentro do prazo. */
export async function redefinirComToken(token, senha) {
  await banco.limparRecuperacoesVencidas();
  const pedido = await banco.recuperacao(resumoToken(String(token || '')));
  if (!pedido) throw new ErroDeUso('Link de redefinição inválido ou já utilizado.', 400);
  if (pedido.expira < agora()) {
    await banco.apagarRecuperacao(resumoToken(String(token)));
    throw new ErroDeUso('Link de redefinição expirado. Solicite outro.', 400);
  }
  const u = pedido.contaId ? await usuarioPorId(pedido.contaId, pedido.usuarioId) : null;
  if (!u) throw new ErroDeUso('Usuário não encontrado.', 404);

  await definirSenha(u.contaId, pedido.usuarioId, senha, u);
  await banco.apagarRecuperacao(resumoToken(String(token)));
  await auditar(u, 'usuarios', u.id, 'alterou', 'Senha redefinida por link enviado ao e-mail');
  return { ok: true, email: u.email };
}

/* ------------------------------------------------------------ auditoria -- */

export function auditar(autor, colecao, registroId, acao, detalhe, antes = null, depois = null) {
  return auditarNaConta(autor?.contaId, autor, colecao, registroId, acao, detalhe, antes, depois);
}

/** A conta vai explícita quando o autor é o próprio sistema, sem usuário. */
export async function auditarNaConta(contaId, autor, colecao, registroId, acao, detalhe,
  antes = null, depois = null) {
  if (!contaId) return null;
  return bancoDa(contaId).registrarAuditoria({
    id: `aud_${randomUUID()}`, quando: agora(),
    usuarioId: autor?.id || null, usuarioNome: autor?.nome || 'Sistema',
    colecao, registroId, acao, detalhe, antes: resumir(antes), depois: resumir(depois),
  });
}

function resumir(obj) {
  if (!obj) return null;
  const { conteudoArquivo, senhaHash, sal, ...limpo } = obj;
  return limpo;
}

/* -------------------------------------------------------------- estado --- */

export async function estadoCompleto(contaId) {
  const bd = bancoDa(contaId);
  const colecoes = {};
  for (const c of COLECOES) {
    const registros = await bd.listar(c, { incluirExcluidos: true });
    colecoes[c] = c === 'usuarios' ? registros.map(publicarUsuario) : registros;
  }
  return {
    colecoes,
    auditoria: await bd.auditoria({ limite: 400 }),
    configuracoes: await bd.configuracoes(),
    servidor: { agora: agora(), persistencia: banco.tipo },
  };
}

export async function estadoDesde(contaId, momento) {
  const bd = bancoDa(contaId);
  const alterados = await bd.alteradosDesde(momento);
  const colecoes = {};
  for (const { colecao, registro } of alterados) {
    (colecoes[colecao] ||= []).push(colecao === 'usuarios' ? publicarUsuario(registro) : registro);
  }
  return {
    colecoes,
    auditoria: await bd.auditoria({ desde: momento, limite: 200 }),
    configuracoes: null,
    servidor: { agora: agora(), persistencia: banco.tipo },
  };
}

export async function salvarConfiguracoes(valor, autor) {
  if (!temPermissao(autor, 'configuracoes:ver')) throw new ErroDeUso('Sem permissão.', 403);
  const bd = bancoDa(autor.contaId);
  const atual = await bd.configuracoes() || {};
  const novo = { ...atual, ...valor };
  await bd.salvarConfiguracoes(novo);
  await auditar(autor, 'configuracoes', 'geral', 'alterou', 'Configurações do sistema');
  return novo;
}

/* ------------------------------------------------------------ mutações --- */

const CAMPOS_PROTEGIDOS = ['criadoEm', 'criadoPor', 'atualizadoEm', 'atualizadoPor',
  'excluidoEm', 'excluidoPor', 'senhaHash', 'sal'];

/**
 * Aplica um lote de gravações vindas do navegador. Cada item é validado,
 * autorizado e auditado individualmente: um item recusado não impede os demais.
 */
export async function aplicarMutacoes(mutacoes, autor) {
  const aplicadas = [];
  const recusadas = [];
  const novaAuditoria = [];

  for (const m of mutacoes) {
    try {
      const registro = await aplicarUma(m, autor, novaAuditoria);
      aplicadas.push({ ref: m.ref || null, colecao: m.colecao, registro });
    } catch (e) {
      recusadas.push({ ref: m.ref || null, colecao: m.colecao, id: m.id || m.dados?.id || null,
        motivo: e.message, status: e.status || 400 });
    }
  }
  return { aplicadas, recusadas, auditoria: novaAuditoria, servidor: { agora: agora() } };
}

async function aplicarUma(m, autor, novaAuditoria) {
  const bd = bancoDa(autor.contaId);
  const { op, colecao } = m;
  if (!COLECOES.includes(colecao)) throw new ErroDeUso(`Coleção desconhecida: ${colecao}.`);
  if (!ACAO_DA_OPERACAO[op]) throw new ErroDeUso(`Operação desconhecida: ${op}.`);

  const permissao = `${MODULO_DA_COLECAO[colecao]}:${ACAO_DA_OPERACAO[op]}`;
  if (!temPermissao(autor, permissao)) {
    throw new ErroDeUso(`Sem permissão para ${permissao}.`, 403);
  }
  if (colecao === 'usuarios' && op === 'inserir') {
    throw new ErroDeUso('Use o cadastro de usuários para criar acessos.', 400);
  }

  const registrar = async (...args) => novaAuditoria.push(await auditar(autor, ...args));

  if (op === 'inserir') {
    const dados = limpar(m.dados);
    if (!dados.id) throw new ErroDeUso('Registro sem identificador.');
    if (await bd.obter(colecao, dados.id)) throw new ErroDeUso('Registro já existente.', 409);
    await validarRegra(bd, colecao, dados, null);
    const registro = { ...dados, criadoEm: agora(), criadoPor: autor.id, atualizadoEm: agora() };
    await bd.gravar(colecao, registro);
    await registrar(colecao, registro.id, 'criou', m.detalhe, null, registro);
    return registro;
  }

  const atual = await bd.obter(colecao, m.id);
  if (!atual) throw new ErroDeUso('Registro não encontrado.', 404);

  if (op === 'atualizar') {
    const dados = limpar(m.dados);
    await validarRegra(bd, colecao, { ...atual, ...dados }, atual.id);
    const registro = { ...atual, ...dados, id: atual.id, atualizadoEm: agora(), atualizadoPor: autor.id };
    await bd.gravar(colecao, registro);
    await registrar(colecao, registro.id, 'alterou', m.detalhe || descreverMudancas(atual, dados), atual, registro);
    return registro;
  }
  if (op === 'remover') {
    const registro = { ...atual, excluidoEm: agora(), excluidoPor: autor.id,
      motivoExclusao: m.detalhe || null, atualizadoEm: agora() };
    await bd.gravar(colecao, registro);
    await registrar(colecao, registro.id, 'excluiu', m.detalhe, atual, null);
    return registro;
  }
  if (op === 'restaurar') {
    const { excluidoEm, excluidoPor, motivoExclusao, ...limpo } = atual;
    const registro = { ...limpo, atualizadoEm: agora(), atualizadoPor: autor.id };
    await bd.gravar(colecao, registro);
    await registrar(colecao, registro.id, 'restaurou', 'Registro recuperado da lixeira', null, registro);
    return registro;
  }
  // removerDefinitivo
  if (!temPermissao(autor, 'configuracoes:ver') && autor.perfil !== 'admin') {
    throw new ErroDeUso('Exclusão definitiva restrita ao administrador.', 403);
  }
  await bd.apagar(colecao, m.id);
  await registrar(colecao, m.id, 'excluiu definitivamente', 'Exclusão irreversível', atual, null);
  return { id: m.id, removidoDefinitivamente: true };
}

const limpar = (dados = {}) => {
  const copia = { ...dados };
  for (const campo of CAMPOS_PROTEGIDOS) delete copia[campo];
  return copia;
};

/** Regras que o servidor não delega ao navegador. */
async function validarRegra(bd, colecao, registro, idAtual) {
  if (colecao === 'processos') {
    const numero = soDigitos(registro.numeroCNJ);
    if (!numero) throw new ErroDeUso('Informe o número do processo.');
    const duplicado = (await bd.listar('processos'))
      .find((p) => soDigitos(p.numeroCNJ) === numero && p.id !== idAtual);
    if (duplicado) {
      throw new ErroDeUso('Já existe processo ativo com este número CNJ.', 409);
    }
  }
  if (colecao === 'prazos' && !registro.dataVencimento) {
    throw new ErroDeUso('Prazo sem data de vencimento.');
  }
  if (colecao === 'usuarios') {
    const permitidos = ['nome', 'perfil', 'oab', 'permissoes', 'ativo', 'ultimoAcesso',
      'email', 'id', 'contaId'];
    for (const chave of Object.keys(registro)) {
      if (!permitidos.includes(chave) && !CAMPOS_PROTEGIDOS.includes(chave)) {
        throw new ErroDeUso(`Campo não editável em usuários: ${chave}.`);
      }
    }
    if (registro.perfil && !PERFIS[registro.perfil]) throw new ErroDeUso('Perfil inválido.');
  }
}

function descreverMudancas(antes, mudancas) {
  const campos = Object.keys(mudancas).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(mudancas[k]));
  return campos.length ? `Campos alterados: ${campos.join(', ')}` : 'Sem alterações efetivas';
}

/* -------------------------------------------------- inicialização base --- */

/**
 * Primeiro acesso do servidor.
 *
 * Havendo qualquer conta, nada se faz: as contas passam a nascer do cadastro de
 * quem usa. O administrador inicial só é criado em servidor recém-instalado, e
 * apenas para que exista alguém antes do primeiro cadastro.
 */
export async function prepararBase() {
  if ((await banco.contas()).length) return null;

  const senha = config.admin.senha || gerarSenhaInicial();
  const { usuario } = await criarConta({
    nome: config.admin.nome, email: config.admin.email, senha, escritorio: 'Escritório',
  });
  return { email: usuario.email, senha, gerada: !config.admin.senha };
}

function gerarSenhaInicial() {
  const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 14 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('');
}
