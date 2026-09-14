// Regras do servidor: autenticação, autorização, validação das gravações,
// auditoria e montagem do estado enviado ao navegador.

import { randomUUID } from 'node:crypto';
import { banco, COLECOES } from './banco.js';
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

export const usuarioPorEmail = (email) =>
  banco.listar('usuarios', { incluirExcluidos: true })
    .find((u) => normalizar(u.email) === normalizar(email)) || null;

export const usuarioPorId = (id) => banco.obter('usuarios', id);

export function criarUsuario({ nome, email, senha, perfil = 'advogado', oab = '', permissoes = null },
  autor = null) {
  if (!nome || !email || !senha) throw new ErroDeUso('Informe nome, e-mail e senha.');
  if (String(senha).length < 8) throw new ErroDeUso('A senha deve ter ao menos 8 caracteres.');
  if (!PERFIS[perfil]) throw new ErroDeUso('Perfil inválido.');
  if (usuarioPorEmail(email)) throw new ErroDeUso('Já existe usuário com este e-mail.');

  const usuario = {
    id: `usu_${randomUUID().slice(0, 12)}`,
    nome, email: normalizar(email), perfil, oab, permissoes, ativo: true,
    criadoEm: agora(), criadoPor: autor?.id || null, atualizadoEm: agora(),
  };
  banco.gravar('usuarios', usuario);
  const { hash, sal } = gerarHashSenha(senha);
  banco.salvarCredencial(usuario.id, hash, sal);
  auditar(autor, 'usuarios', usuario.id, 'criou', `Usuário ${nome} criado`, null, publicarUsuario(usuario));
  return publicarUsuario(usuario);
}

export function definirSenha(usuarioId, senha, autor = null) {
  if (String(senha || '').length < 8) throw new ErroDeUso('A senha deve ter ao menos 8 caracteres.');
  const u = usuarioPorId(usuarioId);
  if (!u) throw new ErroDeUso('Usuário não encontrado.', 404);
  const { hash, sal } = gerarHashSenha(senha);
  banco.salvarCredencial(usuarioId, hash, sal);
  auditar(autor, 'usuarios', usuarioId, 'alterou', 'Senha alterada');
  return { ok: true };
}

export function autenticar(email, senha) {
  const u = usuarioPorEmail(email);
  if (!u || u.ativo === false || u.excluidoEm) throw new ErroDeUso('Credenciais inválidas.', 401);
  const cred = banco.credencial(u.id);
  if (!cred || !senhaConfere(senha, cred.hash, cred.sal)) throw new ErroDeUso('Credenciais inválidas.', 401);
  banco.gravar('usuarios', { ...u, ultimoAcesso: agora(), atualizadoEm: agora() });
  auditar(u, 'usuarios', u.id, 'acessou', 'Acesso ao sistema');
  return publicarUsuario(banco.obter('usuarios', u.id));
}

/* ------------------------------------------------------------ auditoria -- */

export function auditar(autor, colecao, registroId, acao, detalhe, antes = null, depois = null) {
  return banco.registrarAuditoria({
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

export function estadoCompleto() {
  const colecoes = {};
  for (const c of COLECOES) {
    const registros = banco.listar(c, { incluirExcluidos: true });
    colecoes[c] = c === 'usuarios' ? registros.map(publicarUsuario) : registros;
  }
  return {
    colecoes,
    auditoria: banco.auditoria({ limite: 400 }),
    configuracoes: banco.configuracoes(),
    servidor: { agora: agora(), persistencia: banco.tipo },
  };
}

export function estadoDesde(momento) {
  const alterados = banco.alteradosDesde(momento);
  const colecoes = {};
  for (const { colecao, registro } of alterados) {
    (colecoes[colecao] ||= []).push(colecao === 'usuarios' ? publicarUsuario(registro) : registro);
  }
  return {
    colecoes,
    auditoria: banco.auditoria({ desde: momento, limite: 200 }),
    configuracoes: null,
    servidor: { agora: agora(), persistencia: banco.tipo },
  };
}

export function salvarConfiguracoes(valor, autor) {
  if (!temPermissao(autor, 'configuracoes:ver')) throw new ErroDeUso('Sem permissão.', 403);
  const atual = banco.configuracoes() || {};
  const novo = { ...atual, ...valor };
  banco.salvarConfiguracoes(novo);
  auditar(autor, 'configuracoes', 'geral', 'alterou', 'Configurações do sistema');
  return novo;
}

/* ------------------------------------------------------------ mutações --- */

const CAMPOS_PROTEGIDOS = ['criadoEm', 'criadoPor', 'atualizadoEm', 'atualizadoPor',
  'excluidoEm', 'excluidoPor', 'senhaHash', 'sal'];

/**
 * Aplica um lote de gravações vindas do navegador. Cada item é validado,
 * autorizado e auditado individualmente: um item recusado não impede os demais.
 */
export function aplicarMutacoes(mutacoes, autor) {
  const aplicadas = [];
  const recusadas = [];
  const novaAuditoria = [];

  for (const m of mutacoes) {
    try {
      const registro = aplicarUma(m, autor, novaAuditoria);
      aplicadas.push({ ref: m.ref || null, colecao: m.colecao, registro });
    } catch (e) {
      recusadas.push({ ref: m.ref || null, colecao: m.colecao, id: m.id || m.dados?.id || null,
        motivo: e.message, status: e.status || 400 });
    }
  }
  return { aplicadas, recusadas, auditoria: novaAuditoria, servidor: { agora: agora() } };
}

function aplicarUma(m, autor, novaAuditoria) {
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

  const registrar = (...args) => novaAuditoria.push(auditar(autor, ...args));

  if (op === 'inserir') {
    const dados = limpar(m.dados);
    if (!dados.id) throw new ErroDeUso('Registro sem identificador.');
    if (banco.obter(colecao, dados.id)) throw new ErroDeUso('Registro já existente.', 409);
    validarRegra(colecao, dados, null);
    const registro = { ...dados, criadoEm: agora(), criadoPor: autor.id, atualizadoEm: agora() };
    banco.gravar(colecao, registro);
    registrar(colecao, registro.id, 'criou', m.detalhe, null, registro);
    return registro;
  }

  const atual = banco.obter(colecao, m.id);
  if (!atual) throw new ErroDeUso('Registro não encontrado.', 404);

  if (op === 'atualizar') {
    const dados = limpar(m.dados);
    validarRegra(colecao, { ...atual, ...dados }, atual.id);
    const registro = { ...atual, ...dados, id: atual.id, atualizadoEm: agora(), atualizadoPor: autor.id };
    banco.gravar(colecao, registro);
    registrar(colecao, registro.id, 'alterou', m.detalhe || descreverMudancas(atual, dados), atual, registro);
    return registro;
  }
  if (op === 'remover') {
    const registro = { ...atual, excluidoEm: agora(), excluidoPor: autor.id,
      motivoExclusao: m.detalhe || null, atualizadoEm: agora() };
    banco.gravar(colecao, registro);
    registrar(colecao, registro.id, 'excluiu', m.detalhe, atual, null);
    return registro;
  }
  if (op === 'restaurar') {
    const { excluidoEm, excluidoPor, motivoExclusao, ...limpo } = atual;
    const registro = { ...limpo, atualizadoEm: agora(), atualizadoPor: autor.id };
    banco.gravar(colecao, registro);
    registrar(colecao, registro.id, 'restaurou', 'Registro recuperado da lixeira', null, registro);
    return registro;
  }
  // removerDefinitivo
  if (!temPermissao(autor, 'configuracoes:ver') && autor.perfil !== 'admin') {
    throw new ErroDeUso('Exclusão definitiva restrita ao administrador.', 403);
  }
  banco.apagar(colecao, m.id);
  registrar(colecao, m.id, 'excluiu definitivamente', 'Exclusão irreversível', atual, null);
  return { id: m.id, removidoDefinitivamente: true };
}

const limpar = (dados = {}) => {
  const copia = { ...dados };
  for (const campo of CAMPOS_PROTEGIDOS) delete copia[campo];
  return copia;
};

/** Regras que o servidor não delega ao navegador. */
function validarRegra(colecao, registro, idAtual) {
  if (colecao === 'processos') {
    const numero = soDigitos(registro.numeroCNJ);
    if (!numero) throw new ErroDeUso('Informe o número do processo.');
    const duplicado = banco.listar('processos')
      .find((p) => soDigitos(p.numeroCNJ) === numero && p.id !== idAtual);
    if (duplicado) {
      throw new ErroDeUso('Já existe processo ativo com este número CNJ.', 409);
    }
  }
  if (colecao === 'prazos' && !registro.dataVencimento) {
    throw new ErroDeUso('Prazo sem data de vencimento.');
  }
  if (colecao === 'usuarios') {
    const permitidos = ['nome', 'perfil', 'oab', 'permissoes', 'ativo', 'ultimoAcesso', 'email', 'id'];
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

export async function prepararBase() {
  if (!banco.configuracoes()) {
    const { configuracoesPadrao } = await import('./padroes.js');
    banco.salvarConfiguracoes(configuracoesPadrao());
  }
  if (banco.listar('usuarios', { incluirExcluidos: true }).length) return null;

  const senha = config.admin.senha || gerarSenhaInicial();
  criarUsuario({ nome: config.admin.nome, email: config.admin.email, senha, perfil: 'admin' });
  return { email: config.admin.email, senha, gerada: !config.admin.senha };
}

function gerarSenhaInicial() {
  const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 14 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('');
}
