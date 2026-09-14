// Inicialização do servidor.
//
// O SQLite embutido do Node exige a opção --experimental-sqlite até a versão 22
// e dispensa a partir da 23. Para que o comando de início seja sempre o mesmo,
// este arquivo detecta a situação e, quando necessário, reinicia a si próprio
// com a opção correta.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sqliteDisponivel = async () => {
  try { await import('node:sqlite'); return true; } catch { return false; }
};

if (!await sqliteDisponivel()
  && !process.env.SENTINELA_RELANCADO
  && process.allowedNodeEnvironmentFlags.has('--experimental-sqlite')) {
  const resultado = spawnSync(
    process.execPath,
    ['--experimental-sqlite', fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, SENTINELA_RELANCADO: '1' } },
  );
  process.exit(resultado.status ?? 0);
}

const { iniciar } = await import('./servidor.js');
const servidor = await iniciar();

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log('\nEncerrando…');
    servidor.close(() => process.exit(0));
  });
}
