// Persistência.
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
  'feriados', 'suspensoes',
];

let impl = null;

async function abrirSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const bd = new DatabaseSync(join(config.dadosDir, 'sentinela.db'));
  bd.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS registros (
      colecao TEXT NOT NULL,
      id TEXT NOT NULL,
      dados TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      excluido_em TEXT,
      PRIMARY KEY (colecao, id)
    );
    CREATE INDEX IF NOT EXISTS idx_registros_atualizacao ON registros (atualizado_em);
    CREATE TABLE IF NOT EXISTS credenciais (
      usuario_id TEXT PRIMARY KEY, hash TEXT NOT NULL, sal TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auditoria (
      id TEXT PRIMARY KEY, quando TEXT NOT NULL, usuario_id TEXT, usuario_nome TEXT,
      colecao TEXT, registro_id TEXT, acao TEXT, detalhe TEXT, antes TEXT, depois TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_quando ON auditoria (quando);
    CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `);

  const linhaParaRegistro = (l) => JSON.parse(l.dados);

  return {
    tipo: 'sqlite',
    listar(colecao, { incluirExcluidos = false } = {}) {
      const sql = `SELECT dados FROM registros WHERE colecao = ?${incluirExcluidos ? '' : ' AND excluido_em IS NULL'}`;
      return bd.prepare(sql).all(colecao).map(linhaParaRegistro);
    },
    obter(colecao, id) {
      const l = bd.prepare('SELECT dados FROM registros WHERE colecao = ? AND id = ?').get(colecao, id);
      return l ? linhaParaRegistro(l) : null;
    },
    gravar(colecao, registro) {
      bd.prepare(`INSERT INTO registros (colecao, id, dados, atualizado_em, excluido_em)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (colecao, id) DO UPDATE SET dados = excluded.dados,
          atualizado_em = excluded.atualizado_em, excluido_em = excluded.excluido_em`)
        .run(colecao, registro.id, JSON.stringify(registro),
          registro.atualizadoEm || new Date().toISOString(), registro.excluidoEm || null);
      return registro;
    },
    apagar(colecao, id) {
      bd.prepare('DELETE FROM registros WHERE colecao = ? AND id = ?').run(colecao, id);
    },
    alteradosDesde(momento) {
      const linhas = bd.prepare(
        'SELECT colecao, dados FROM registros WHERE atualizado_em > ? ORDER BY atualizado_em',
      ).all(momento);
      return linhas.map((l) => ({ colecao: l.colecao, registro: JSON.parse(l.dados) }));
    },
    credencial(usuarioId) {
      return bd.prepare('SELECT hash, sal FROM credenciais WHERE usuario_id = ?').get(usuarioId) || null;
    },
    salvarCredencial(usuarioId, hash, sal) {
      bd.prepare(`INSERT INTO credenciais (usuario_id, hash, sal, atualizado_em) VALUES (?, ?, ?, ?)
        ON CONFLICT (usuario_id) DO UPDATE SET hash = excluded.hash, sal = excluded.sal,
        atualizado_em = excluded.atualizado_em`).run(usuarioId, hash, sal, new Date().toISOString());
    },
    registrarAuditoria(e) {
      bd.prepare(`INSERT INTO auditoria (id, quando, usuario_id, usuario_nome, colecao,
        registro_id, acao, detalhe, antes, depois) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(e.id, e.quando, e.usuarioId, e.usuarioNome, e.colecao, e.registroId, e.acao,
          e.detalhe || null, e.antes ? JSON.stringify(e.antes) : null,
          e.depois ? JSON.stringify(e.depois) : null);
      return e;
    },
    auditoria({ desde = null, limite = 500 } = {}) {
      const sql = desde
        ? 'SELECT * FROM auditoria WHERE quando > ? ORDER BY quando DESC LIMIT ?'
        : 'SELECT * FROM auditoria ORDER BY quando DESC LIMIT ?';
      const linhas = desde ? bd.prepare(sql).all(desde, limite) : bd.prepare(sql).all(limite);
      return linhas.map((l) => ({
        id: l.id, quando: l.quando, usuarioId: l.usuario_id, usuarioNome: l.usuario_nome,
        colecao: l.colecao, registroId: l.registro_id, acao: l.acao, detalhe: l.detalhe,
      }));
    },
    configuracoes() {
      const l = bd.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get('geral');
      return l ? JSON.parse(l.valor) : null;
    },
    salvarConfiguracoes(valor) {
      bd.prepare(`INSERT INTO configuracoes (chave, valor) VALUES ('geral', ?)
        ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`).run(JSON.stringify(valor));
      return valor;
    },
    fechar() { bd.close(); },
  };
}

function abrirJson() {
  const arquivo = join(config.dadosDir, 'sentinela.json');
  const vazio = { registros: {}, credenciais: {}, auditoria: [], configuracoes: null };
  let estado = existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) : vazio;

  const salvar = () => {
    const temp = `${arquivo}.tmp`;
    writeFileSync(temp, JSON.stringify(estado), { mode: 0o600 });
    renameSync(temp, arquivo); // gravação atômica: evita arquivo truncado
  };
  const mapa = (c) => (estado.registros[c] ||= {});

  return {
    tipo: 'json',
    listar(colecao, { incluirExcluidos = false } = {}) {
      return Object.values(mapa(colecao)).filter((r) => incluirExcluidos || !r.excluidoEm);
    },
    obter(colecao, id) { return mapa(colecao)[id] || null; },
    gravar(colecao, registro) { mapa(colecao)[registro.id] = registro; salvar(); return registro; },
    apagar(colecao, id) { delete mapa(colecao)[id]; salvar(); },
    alteradosDesde(momento) {
      const saida = [];
      for (const [colecao, registros] of Object.entries(estado.registros)) {
        for (const r of Object.values(registros)) {
          if ((r.atualizadoEm || '') > momento) saida.push({ colecao, registro: r });
        }
      }
      return saida.sort((a, b) => String(a.registro.atualizadoEm).localeCompare(b.registro.atualizadoEm));
    },
    credencial(usuarioId) { return estado.credenciais[usuarioId] || null; },
    salvarCredencial(usuarioId, hash, sal) { estado.credenciais[usuarioId] = { hash, sal }; salvar(); },
    registrarAuditoria(e) { estado.auditoria.unshift(e); estado.auditoria.length = Math.min(estado.auditoria.length, 20000); salvar(); return e; },
    auditoria({ desde = null, limite = 500 } = {}) {
      return estado.auditoria.filter((a) => !desde || a.quando > desde).slice(0, limite);
    },
    configuracoes() { return estado.configuracoes; },
    salvarConfiguracoes(valor) { estado.configuracoes = valor; salvar(); return valor; },
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
