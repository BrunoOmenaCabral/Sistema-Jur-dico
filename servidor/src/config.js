// Configuração do servidor. Tudo por variável de ambiente, com padrões seguros
// para uso local. Nenhum segredo fica no código.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(aqui, '..', '..');

export const config = {
  porta: Number(process.env.PORTA || process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dadosDir: resolve(process.env.SENTINELA_DADOS || join(RAIZ, 'servidor', 'dados')),
  estaticos: resolve(process.env.SENTINELA_ESTATICOS || join(RAIZ, 'sentinela')),
  // Marque como true quando o servidor estiver atrás de HTTPS: o cookie de sessão
  // passa a exigir conexão segura.
  seguro: process.env.SENTINELA_HTTPS === 'true',
  duracaoSessaoHoras: Number(process.env.SENTINELA_SESSAO_HORAS || 12),
  limiteCorpoBytes: Number(process.env.SENTINELA_LIMITE_CORPO || 12 * 1024 * 1024),
  admin: {
    nome: process.env.SENTINELA_ADMIN_NOME || 'Administrador',
    email: (process.env.SENTINELA_ADMIN_EMAIL || 'admin@escritorio.adv.br').toLowerCase(),
    senha: process.env.SENTINELA_ADMIN_SENHA || '',
  },
  semearDemonstracao: process.env.SENTINELA_DEMO === 'true',
};

if (!existsSync(config.dadosDir)) mkdirSync(config.dadosDir, { recursive: true });

/**
 * Segredo de assinatura das sessões. Vem do ambiente ou é gerado uma única vez
 * e guardado com permissão restrita no diretório de dados.
 */
export const segredo = (() => {
  if (process.env.SENTINELA_SEGREDO) return process.env.SENTINELA_SEGREDO;
  const arquivo = join(config.dadosDir, 'segredo.chave');
  if (existsSync(arquivo)) return readFileSync(arquivo, 'utf8').trim();
  const novo = randomBytes(48).toString('hex');
  writeFileSync(arquivo, novo, { mode: 0o600 });
  return novo;
})();
