// Persistência multiconta.
//
// Cada conta é um escritório: seus dados não se encontram com os de outro em
// consulta alguma, porque toda leitura e toda gravação passam pela conta. O
// isolamento fica na camada de acesso, e não na lembrança de quem chama —
// esquecer o filtro deixaria um escritório ver o processo do outro.
//
// Usa o SQLite embutido do Node (node:sqlite). Quando ele não está disponível
// — versões antigas ou execução sem a flag experimental — cai para um arquivo
// JSON com gravação atômica, mantendo exatamente a mesma interface.

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { config } from './config.js';

export const COLECOES = [
  'usuarios', 'clientes', 'processos', 'prazos', 'tarefas', 'audiencias',
  'publicacoes', 'documentos', 'comunicacoes', 'financeiro', 'movimentacoes',
  'receitas', 'cobrancas', 'feriados', 'suspensoes',
];

// Conta para onde vão os dados de base criada antes da separação por conta.
export const CONTA_INICIAL = 'conta_inicial';

let impl = null;

const agora = () => new Date().toISOString();
const normalizarEmail = (s) => String(s ?? '').trim().toLowerCase();

async function abrirSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const bd = new DatabaseSync(join(config.dadosDir, 'sentinela.db'));
  bd.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS contas (
      id TEXT PRIMARY KEY, nome TEXT NOT NULL, criado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registros (
      conta_id TEXT NOT NULL DEFAULT '${CONTA_INICIAL}',
      colecao TEXT NOT NULL,
      id TEXT NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      excluido_em TEXT,
      PRIMARY KEY (conta_id, colecao, id)
    );
    CREATE INDEX IF NOT EXISTS idx_registros_atualizacao ON registros (conta_id, atualizado_em);
    -- O acesso é por e-mail, que não se repete entre contas: é por aqui que se
    -- descobre a conta de quem está entrando.
    CREATE TABLE IF NOT EXISTS usuarios_indice (
      email TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, conta_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credenciais (
      usuario_id TEXT PRIMARY KEY, hash TEXT NOT NULL, sal TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auditoria (
      id TEXT PRIMARY KEY, conta_id TEXT NOT NULL DEFAULT '${CONTA_INICIAL}',
      quando TEXT NOT NULL, usuario_id TEXT, usuario_nome TEXT,
      colecao TEXT, registro_id TEXT, acao TEXT, detalhe TEXT, antes TEXT, depois TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_quando ON auditoria (conta_id, quando);
    CREATE TABLE IF NOT EXISTS configuracoes (
      conta_id TEXT NOT NULL DEFAULT '${CONTA_INICIAL}', chave TEXT NOT NULL, valor TEXT NOT NULL,
      PRIMARY KEY (conta_id, chave)
    );
    CREATE TABLE IF NOT EXISTS recuperacoes (
      token_hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, conta_id TEXT NOT NULL DEFAULT '',
      expira TEXT NOT NULL, criado_em TEXT NOT NULL
    );
  `);

  migrarParaContas(bd);

  const registro = (l) => JSON.parse(l.dados);

  return {
    tipo: 'sqlite',

    /* ------------------------------------------------------------ contas -- */
    criarConta(id, nome) {
      bd.prepare('INSERT OR IGNORE INTO contas (id, nome, criado_em) VALUES (?, ?, ?)')
        .run(id, nome, agora());
      return { id, nome };
    },
    conta(id) {
      return bd.prepare('SELECT id, nome, criado_em FROM contas WHERE id = ?').get(id) || null;
    },
    contas() {
      return bd.prepare('SELECT id, nome, criado_em FROM contas ORDER BY criado_em').all();
    },
    acessoPorEmail(email) {
      const l = bd.prepare('SELECT usuario_id, conta_id FROM usuarios_indice WHERE email = ?')
        .get(normalizarEmail(email));
      return l ? { usuarioId: l.usuario_id, contaId: l.conta_id } : null;
    },

    /* ---------------------------------------------------------- registros -- */
    listar(contaId, colecao, { incluirExcluidos = false } = {}) {
      const sql = `SELECT dados FROM registros WHERE conta_id = ? AND colecao = ?`
        + `${incluirExcluidos ? '' : ' AND excluido_em IS NULL'}`;
      return bd.prepare(sql).all(contaId, colecao).map(registro);
    },
    obter(contaId, colecao, id) {
      const l = bd.prepare('SELECT dados FROM registros WHERE conta_id = ? AND colecao = ? AND id = ?')
        .get(contaId, colecao, id);
      return l ? registro(l) : null;
    },
    gravar(contaId, colecao, reg) {
      bd.prepare(`INSERT INTO registros (conta_id, colecao, id, dados, atualizado_em, excluido_em)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (conta_id, colecao, id) DO UPDATE SET dados = excluded.dados,
          atualizado_em = excluded.atualizado_em, excluido_em = excluded.excluido_em`)
        .run(contaId, colecao, reg.id, JSON.stringify(reg),
          reg.atualizadoEm || agora(), reg.excluidoEm || null);
      if (colecao === 'usuarios') indexarUsuario(bd, contaId, reg);
      return reg;
    },
    apagar(contaId, colecao, id) {
      if (colecao === 'usuarios') {
        bd.prepare('DELETE FROM usuarios_indice WHERE usuario_id = ?').run(id);
      }
      bd.prepare('DELETE FROM registros WHERE conta_id = ? AND colecao = ? AND id = ?')
        .run(contaId, colecao, id);
    },
    alteradosDesde(contaId, momento) {
      return bd.prepare(`SELECT colecao, dados FROM registros
        WHERE conta_id = ? AND atualizado_em > ? ORDER BY atualizado_em`)
        .all(contaId, momento)
        .map((l) => ({ colecao: l.colecao, registro: JSON.parse(l.dados) }));
    },

    /* -------------------------------------------------------- credenciais -- */
    credencial(usuarioId) {
      return bd.prepare('SELECT hash, sal FROM credenciais WHERE usuario_id = ?').get(usuarioId) || null;
    },
    salvarCredencial(usuarioId, hash, sal) {
      bd.prepare(`INSERT INTO credenciais (usuario_id, hash, sal, atualizado_em) VALUES (?, ?, ?, ?)
        ON CONFLICT (usuario_id) DO UPDATE SET hash = excluded.hash, sal = excluded.sal,
        atualizado_em = excluded.atualizado_em`).run(usuarioId, hash, sal, agora());
    },
    salvarRecuperacao(tokenHash, usuarioId, contaId, expira) {
      bd.prepare('DELETE FROM recuperacoes WHERE usuario_id = ?').run(usuarioId);
      bd.prepare(`INSERT INTO recuperacoes (token_hash, usuario_id, conta_id, expira, criado_em)
        VALUES (?, ?, ?, ?, ?)`).run(tokenHash, usuarioId, contaId, expira, agora());
    },
    recuperacao(tokenHash) {
      const l = bd.prepare('SELECT usuario_id, conta_id, expira FROM recuperacoes WHERE token_hash = ?')
        .get(tokenHash);
      return l ? { usuarioId: l.usuario_id, contaId: l.conta_id, expira: l.expira } : null;
    },
    apagarRecuperacao(tokenHash) {
      bd.prepare('DELETE FROM recuperacoes WHERE token_hash = ?').run(tokenHash);
    },
    limparRecuperacoesVencidas() {
      bd.prepare('DELETE FROM recuperacoes WHERE expira < ?').run(agora());
    },

    /* ---------------------------------------------------------- auditoria -- */
    registrarAuditoria(contaId, e) {
      bd.prepare(`INSERT INTO auditoria (id, conta_id, quando, usuario_id, usuario_nome, colecao,
        registro_id, acao, detalhe, antes, depois) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(e.id, contaId, e.quando, e.usuarioId, e.usuarioNome, e.colecao, e.registroId, e.acao,
          e.detalhe || null, e.antes ? JSON.stringify(e.antes) : null,
          e.depois ? JSON.stringify(e.depois) : null);
      return e;
    },
    auditoria(contaId, { desde = null, limite = 500 } = {}) {
      const linhas = desde
        ? bd.prepare(`SELECT * FROM auditoria WHERE conta_id = ? AND quando > ?
            ORDER BY quando DESC LIMIT ?`).all(contaId, desde, limite)
        : bd.prepare('SELECT * FROM auditoria WHERE conta_id = ? ORDER BY quando DESC LIMIT ?')
          .all(contaId, limite);
      return linhas.map((l) => ({
        id: l.id, quando: l.quando, usuarioId: l.usuario_id, usuarioNome: l.usuario_nome,
        colecao: l.colecao, registroId: l.registro_id, acao: l.acao, detalhe: l.detalhe,
      }));
    },

    /* ------------------------------------------------------ configurações -- */
    configuracoes(contaId) {
      const l = bd.prepare('SELECT valor FROM configuracoes WHERE conta_id = ? AND chave = ?')
        .get(contaId, 'geral');
      return l ? JSON.parse(l.valor) : null;
    },
    salvarConfiguracoes(contaId, valor) {
      bd.prepare(`INSERT INTO configuracoes (conta_id, chave, valor) VALUES (?, 'geral', ?)
        ON CONFLICT (conta_id, chave) DO UPDATE SET valor = excluded.valor`)
        .run(contaId, JSON.stringify(valor));
      return valor;
    },
    fechar() { bd.close(); },
  };
}

/** Mantém o índice de acesso alinhado ao usuário gravado. */
function indexarUsuario(bd, contaId, usuario) {
  bd.prepare('DELETE FROM usuarios_indice WHERE usuario_id = ?').run(usuario.id);
  if (usuario.excluidoEm || !usuario.email) return;
  bd.prepare(`INSERT INTO usuarios_indice (email, usuario_id, conta_id) VALUES (?, ?, ?)
    ON CONFLICT (email) DO UPDATE SET usuario_id = excluded.usuario_id,
    conta_id = excluded.conta_id`).run(normalizarEmail(usuario.email), usuario.id, contaId);
}

/**
 * Base gravada antes da separação por conta.
 *
 * Tudo o que existia passa a pertencer à conta inicial, e o índice de acesso é
 * reconstruído a partir dos usuários já cadastrados. Sem isto, quem já usava o
 * servidor perderia o acesso na atualização.
 */
function migrarParaContas(bd) {
  const colunas = (tabela) => bd.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);

  for (const tabela of ['registros', 'auditoria', 'configuracoes', 'recuperacoes']) {
    if (!colunas(tabela).includes('conta_id')) {
      bd.exec(`ALTER TABLE ${tabela} ADD COLUMN conta_id TEXT NOT NULL DEFAULT '${CONTA_INICIAL}'`);
    }
  }

  const usuarios = bd.prepare(
    "SELECT conta_id, dados FROM registros WHERE colecao = 'usuarios'",
  ).all();
  if (!usuarios.length) return;

  bd.prepare('INSERT OR IGNORE INTO contas (id, nome, criado_em) VALUES (?, ?, ?)')
    .run(CONTA_INICIAL, 'Escritório', agora());
  for (const l of usuarios) indexarUsuario(bd, l.conta_id || CONTA_INICIAL, JSON.parse(l.dados));
}

function abrirJson() {
  const arquivo = join(config.dadosDir, 'sentinela.json');
  const vazio = { contas: {}, registros: {}, credenciais: {}, auditoria: [],
    configuracoes: {}, recuperacoes: {}, acessos: {} };
  let estado = existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) : vazio;

  // Base anterior à separação por conta: o que existia vai para a conta inicial.
  if (!estado.contas) {
    const antigos = estado.registros || {};
    estado = {
      contas: Object.keys(antigos).length
        ? { [CONTA_INICIAL]: { id: CONTA_INICIAL, nome: 'Escritório', criadoEm: agora() } } : {},
      registros: Object.keys(antigos).length ? { [CONTA_INICIAL]: antigos } : {},
      credenciais: estado.credenciais || {},
      auditoria: (estado.auditoria || []).map((a) => ({ ...a, contaId: CONTA_INICIAL })),
      configuracoes: estado.configuracoes ? { [CONTA_INICIAL]: estado.configuracoes } : {},
      recuperacoes: estado.recuperacoes || {},
      acessos: {},
    };
    for (const u of Object.values(estado.registros[CONTA_INICIAL]?.usuarios || {})) {
      if (u.email) estado.acessos[normalizarEmail(u.email)] = { usuarioId: u.id, contaId: CONTA_INICIAL };
    }
  }
  estado.acessos ||= {};

  const salvar = () => {
    const temp = `${arquivo}.tmp`;
    writeFileSync(temp, JSON.stringify(estado), { mode: 0o600 });
    renameSync(temp, arquivo); // gravação atômica: evita arquivo truncado
  };
  const mapa = (contaId, colecao) => {
    estado.registros[contaId] ||= {};
    return (estado.registros[contaId][colecao] ||= {});
  };
  const indexar = (contaId, usuario) => {
    for (const [email, a] of Object.entries(estado.acessos)) {
      if (a.usuarioId === usuario.id) delete estado.acessos[email];
    }
    if (!usuario.excluidoEm && usuario.email) {
      estado.acessos[normalizarEmail(usuario.email)] = { usuarioId: usuario.id, contaId };
    }
  };

  return {
    tipo: 'json',

    criarConta(id, nome) {
      estado.contas[id] ||= { id, nome, criadoEm: agora() };
      salvar();
      return estado.contas[id];
    },
    conta(id) { return estado.contas[id] || null; },
    contas() { return Object.values(estado.contas); },
    acessoPorEmail(email) { return estado.acessos[normalizarEmail(email)] || null; },

    listar(contaId, colecao, { incluirExcluidos = false } = {}) {
      return Object.values(mapa(contaId, colecao)).filter((r) => incluirExcluidos || !r.excluidoEm);
    },
    obter(contaId, colecao, id) { return mapa(contaId, colecao)[id] || null; },
    gravar(contaId, colecao, reg) {
      mapa(contaId, colecao)[reg.id] = reg;
      if (colecao === 'usuarios') indexar(contaId, reg);
      salvar();
      return reg;
    },
    apagar(contaId, colecao, id) {
      if (colecao === 'usuarios') {
        for (const [email, a] of Object.entries(estado.acessos)) {
          if (a.usuarioId === id) delete estado.acessos[email];
        }
      }
      delete mapa(contaId, colecao)[id];
      salvar();
    },
    alteradosDesde(contaId, momento) {
      const saida = [];
      for (const [colecao, registros] of Object.entries(estado.registros[contaId] || {})) {
        for (const r of Object.values(registros)) {
          if ((r.atualizadoEm || '') > momento) saida.push({ colecao, registro: r });
        }
      }
      return saida.sort((a, b) => String(a.registro.atualizadoEm).localeCompare(b.registro.atualizadoEm));
    },

    credencial(usuarioId) { return estado.credenciais[usuarioId] || null; },
    salvarCredencial(usuarioId, hash, sal) { estado.credenciais[usuarioId] = { hash, sal }; salvar(); },
    salvarRecuperacao(tokenHash, usuarioId, contaId, expira) {
      for (const [chave, r] of Object.entries(estado.recuperacoes)) {
        if (r.usuarioId === usuarioId) delete estado.recuperacoes[chave];
      }
      estado.recuperacoes[tokenHash] = { usuarioId, contaId, expira, criadoEm: agora() };
      salvar();
    },
    recuperacao(tokenHash) { return estado.recuperacoes[tokenHash] || null; },
    apagarRecuperacao(tokenHash) { delete estado.recuperacoes[tokenHash]; salvar(); },
    limparRecuperacoesVencidas() {
      const limite = agora();
      for (const [chave, r] of Object.entries(estado.recuperacoes)) {
        if (r.expira < limite) delete estado.recuperacoes[chave];
      }
      salvar();
    },

    registrarAuditoria(contaId, e) {
      estado.auditoria.unshift({ ...e, contaId });
      estado.auditoria.length = Math.min(estado.auditoria.length, 20000);
      salvar();
      return e;
    },
    auditoria(contaId, { desde = null, limite = 500 } = {}) {
      return estado.auditoria
        .filter((a) => a.contaId === contaId && (!desde || a.quando > desde))
        .slice(0, limite);
    },

    configuracoes(contaId) { return estado.configuracoes[contaId] || null; },
    salvarConfiguracoes(contaId, valor) {
      estado.configuracoes[contaId] = valor; salvar(); return valor;
    },
    fechar() { salvar(); },
  };
}

export async function abrirBanco() {
  if (impl) return impl;
  try {
    impl = await abrirSqlite();
  } catch (e) {
    console.warn(`SQLite indisponível (${e.message}). Usando persistência em arquivo JSON.`);
    impl = abrirJson();
  }
  console.log(`Persistência: ${impl.tipo} em ${config.dadosDir}`);
  return impl;
}

export const banco = new Proxy({}, {
  get(_alvo, prop) {
    if (!impl) throw new Error('Banco não inicializado. Chame abrirBanco() antes.');
    return impl[prop];
  },
});

/**
 * Acesso já preso a uma conta.
 *
 * Toda operação de dados passa por aqui, e não pelo banco direto: a conta deixa
 * de ser argumento que se pode esquecer e vira condição para chegar ao dado.
 */
export function bancoDa(contaId) {
  if (!contaId) throw new Error('Operação sem conta definida.');
  return {
    listar: (colecao, opcoes) => banco.listar(contaId, colecao, opcoes),
    obter: (colecao, id) => banco.obter(contaId, colecao, id),
    gravar: (colecao, reg) => banco.gravar(contaId, colecao, reg),
    apagar: (colecao, id) => banco.apagar(contaId, colecao, id),
    alteradosDesde: (momento) => banco.alteradosDesde(contaId, momento),
    registrarAuditoria: (e) => banco.registrarAuditoria(contaId, e),
    auditoria: (opcoes) => banco.auditoria(contaId, opcoes),
    configuracoes: () => banco.configuracoes(contaId),
    salvarConfiguracoes: (valor) => banco.salvarConfiguracoes(contaId, valor),
  };
}
