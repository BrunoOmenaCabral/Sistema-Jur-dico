// Configuração do servidor. Tudo por variável de ambiente, com padrões seguros
// para uso local. Nenhum segredo fica no código.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(aqui, '..', '..');

const semEspacos = (v) => String(v || '').replace(/[\s"']/g, '');

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
  // Consulta pública de comunicações do CNJ, repassada pelo servidor.
  djenBase: (process.env.SENTINELA_DJEN_BASE || 'https://comunicaapi.pje.jus.br/api/v1').replace(/\/$/, ''),
  // O CNJ recusa consulta originada fora do Brasil. Quando a hospedagem do
  // servidor fica no exterior, a consulta precisa sair de uma ponte no país:
  // o endereço completo dela vai aqui, e recebe os parâmetros direto na
  // consulta, sem sufixo de caminho.
  djenPonte: (process.env.SENTINELA_DJEN_PONTE || '').trim().replace(/\?$/, ''),
  tempoLimiteConsultaMs: Number(process.env.SENTINELA_CONSULTA_TIMEOUT || 25000),
  // Envio de e-mail por API HTTP do provedor. Sem isso, a redefinição de senha
  // é criada mas não sai do servidor, e quem pediu é avisado disso.
  email: {
    endpoint: process.env.SENTINELA_EMAIL_ENDPOINT || '',
    chave: process.env.SENTINELA_EMAIL_CHAVE || '',
    remetente: process.env.SENTINELA_EMAIL_REMETENTE || '',
  },
  // DataJud: base pública do CNJ com a capa e os movimentos dos tribunais.
  // A chave é pública, divulgada pelo próprio CNJ, e pode ser trocada por
  // ambiente caso o Conselho a rotacione.
  datajudBase: (process.env.SENTINELA_DATAJUD_BASE
    || 'https://api-publica.datajud.cnj.jus.br').replace(/\/$/, ''),
  datajudChave: process.env.SENTINELA_DATAJUD_CHAVE
    || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==',
  // Endereço público do sistema, usado no link enviado por e-mail.
  // Banco gerenciado: com ele, a hospedagem dispensa disco próprio.
  turso: {
    // Nem URL nem token têm espaço em branco. Colados no painel da
    // hospedagem, porém, chegam com frequência quebrados em linhas ou com um
    // "Bearer " na frente, e o banco recusa sem dizer o porquê. Limpar aqui
    // custa nada e evita um erro que não se enxerga lendo o valor na tela.
    url: semEspacos(process.env.TURSO_DATABASE_URL),
    token: semEspacos(process.env.TURSO_AUTH_TOKEN).replace(/^Bearer\s*/i, ''),
  },
  enderecoPublico: (process.env.SENTINELA_ENDERECO || '').replace(/\/$/, ''),
  minutosRecuperacao: Number(process.env.SENTINELA_RECUPERACAO_MINUTOS || 30),
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
