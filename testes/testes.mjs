// Testes do núcleo (sem interface). Execução: node sentinela/testes/testes.mjs
//
// Cobrem o que não pode falhar: validação do número CNJ, calendário forense,
// contagem de prazos, leitura de publicações e prevenção de conflitos.

import assert from 'node:assert/strict';

/* Armazenamento em memória para rodar o store fora do navegador. */
class Memoria {
  #d = new Map();
  getItem(k) { return this.#d.has(k) ? this.#d.get(k) : null; }
  setItem(k, v) { this.#d.set(k, String(v)); }
  removeItem(k) { this.#d.delete(k); }
  key(i) { return [...this.#d.keys()][i]; }
  get length() { return this.#d.size; }
}
globalThis.localStorage = new Memoria();
globalThis.sessionStorage = new Memoria();
Object.keys = ((orig) => (o) => (o instanceof Memoria ? [] : orig(o)))(Object.keys);

const { validarCNJ, fmtCNJ, addDays, hoje, diffDias } = await import('../src/core/util.js');
const { pascoa, calendarioAplicavel, ehDiaUtil, proximoDiaUtil } = await import('../src/core/feriados.js');
const { calcularPrazo } = await import('../src/core/calculo-prazo.js');
const { db } = await import('../src/core/store.js');
const { interpretarPublicacao, relatorioCliente } = await import('../src/core/ia.js');
const { conflitosDePrazo, indicadores, eventosAgenda, linhaDoTempo } = await import('../src/core/dominio.js');

let passou = 0;
const teste = (nome, fn) => {
  try { fn(); passou += 1; console.log(`  ok  ${nome}`); }
  catch (e) { console.error(`FALHA  ${nome}\n       ${e.message}`); process.exitCode = 1; }
};

console.log('\nNúmero do processo (CNJ)');
teste('aceita número com dígito verificador correto', () => {
  assert.equal(validarCNJ('0801701-82.2018.8.17.0001').valido, true);
});
teste('rejeita dígito verificador incorreto', () => {
  assert.equal(validarCNJ('0801701-07.2018.8.17.0001').valido, false);
});
teste('rejeita número incompleto', () => {
  assert.equal(validarCNJ('123').valido, false);
});
teste('formata no padrão do CNJ', () => {
  assert.equal(fmtCNJ('08017018220188170001'), '0801701-82.2018.8.17.0001');
});

console.log('\nCalendário forense');
const cal = calendarioAplicavel([2025, 2026], { uf: 'PE' }, {});
teste('calcula a Páscoa', () => {
  assert.equal(pascoa(2026), '2026-04-05');
  assert.equal(pascoa(2025), '2025-04-20');
});
teste('carnaval não é dia útil', () => assert.equal(ehDiaUtil('2026-02-17', cal), false));
teste('corpus christi não é dia útil', () => assert.equal(ehDiaUtil('2026-06-04', cal), false));
teste('recesso forense suspende o expediente', () => assert.equal(ehDiaUtil('2026-01-05', cal), false));
teste('primeiro dia útil após o recesso', () => assert.equal(proximoDiaUtil('2026-01-02', cal), '2026-01-21'));
teste('feriado estadual configurado é respeitado', () => {
  const c = calendarioAplicavel([2026], { uf: 'PE' },
    { feriados: [{ data: '2026-06-24', nome: 'São João', abrangencia: 'estadual', uf: 'PE' }] });
  assert.equal(ehDiaUtil('2026-06-24', c), false);
  const outraUF = calendarioAplicavel([2026], { uf: 'SP' },
    { feriados: [{ data: '2026-06-24', nome: 'São João', abrangencia: 'estadual', uf: 'PE' }] });
  assert.equal(ehDiaUtil('2026-06-24', outraUF), true);
});

console.log('\nContagem de prazos');
teste('15 dias úteis a partir de publicação em 02/09/2026', () => {
  const r = calcularPrazo({ dataPublicacao: '2026-09-02', dias: 15, contagem: 'uteis' });
  assert.equal(r.inicio, '2026-09-03');
  assert.equal(r.vencimento, '2026-09-24');
});
teste('exclui o dia da publicação e inicia em dia útil', () => {
  const r = calcularPrazo({ dataPublicacao: '2026-09-04', dias: 5, contagem: 'uteis' });
  assert.equal(r.inicio, '2026-09-08'); // 05 e 06 fim de semana, 07 feriado
});
teste('disponibilização gera publicação no primeiro dia útil seguinte', () => {
  const r = calcularPrazo({ dataDisponibilizacao: '2026-09-03', dias: 15, contagem: 'uteis' });
  assert.equal(r.dataPublicacao, '2026-09-04');
  assert.equal(r.inicio, '2026-09-08');
});
teste('prorroga vencimento que cai em dia não útil', () => {
  const r = calcularPrazo({ dataPublicacao: '2026-09-02', dias: 3, contagem: 'corridos' });
  assert.equal(r.vencimento, '2026-09-08'); // 05 sáb, 06 dom, 07 feriado
});
teste('dias corridos não desprezam fim de semana', () => {
  const r = calcularPrazo({ dataPublicacao: '2026-09-08', dias: 10, contagem: 'corridos' });
  assert.equal(r.inicio, '2026-09-09');
  assert.equal(r.vencimento, '2026-09-18');
});
teste('prazo em dobro multiplica a contagem', () => {
  const simples = calcularPrazo({ dataPublicacao: '2026-09-02', dias: 15, contagem: 'uteis' });
  const dobro = calcularPrazo({ dataPublicacao: '2026-09-02', dias: 15, contagem: 'uteis', multiplicador: 2 });
  assert.equal(dobro.dias, 30);
  assert.ok(dobro.vencimento > simples.vencimento);
});
teste('atravessa o recesso do art. 220 do CPC', () => {
  const r = calcularPrazo({ dataPublicacao: '2026-12-15', dias: 15, contagem: 'uteis' });
  assert.ok(r.vencimento > '2027-01-20');
  assert.ok(r.suspensoes.length > 0);
});
teste('registra a regra utilizada', () => {
  const r = calcularPrazo({ dataPublicacao: '2026-09-02', dias: 15, contagem: 'uteis',
    contexto: { tribunal: 'TJPE', uf: 'PE' } });
  assert.match(r.resumoRegra, /15 dias úteis/);
  assert.match(r.resumoRegra, /TJPE/);
  assert.ok(r.passos.length >= 3);
});
teste('exige informação suficiente para calcular', () => {
  assert.ok(calcularPrazo({ dias: 15, contagem: 'uteis' }).erro);
  assert.ok(calcularPrazo({ dataPublicacao: '2026-09-02', contagem: 'uteis' }).erro);
});

console.log('\nBase de demonstração');
const { semear } = await import('../src/core/seed.js');
await semear();
const processo = db.listar('processos')[0];
teste('semeadura cria usuários, clientes e processos', () => {
  assert.ok(db.listar('usuarios').length >= 3);
  assert.ok(db.listar('clientes').length >= 3);
  assert.ok(db.listar('processos').length >= 4);
});
teste('números gerados na base são válidos', () => {
  for (const p of db.listar('processos')) assert.equal(validarCNJ(p.numeroCNJ).valido, true);
});

console.log('\nLeitura de publicações');
teste('identifica processo, tipo e prazo', () => {
  const s = interpretarPublicacao({
    numeroCNJ: processo.numeroCNJ, dataPublicacao: '2026-09-02',
    conteudo: 'Intime-se a parte autora para manifestação no prazo de 15 (quinze) dias.',
  });
  assert.equal(s.processoId, processo.id);
  assert.equal(s.tipo, 'manifestacao');
  assert.equal(s.dias, 15);
  assert.equal(s.vencimentoSugerido, '2026-09-24');
  assert.equal(s.exigeConfirmacao, true);
});
teste('não confunde manifestação sobre contestação com prazo de defesa', () => {
  const s = interpretarPublicacao({ numeroCNJ: processo.numeroCNJ, dataPublicacao: '2026-09-02',
    conteudo: 'Manifeste-se a parte autora sobre a contestação no prazo de 15 dias.' });
  assert.equal(s.tipo, 'manifestacao');
});
teste('lê prazo escrito por extenso', () => {
  const s = interpretarPublicacao({ numeroCNJ: processo.numeroCNJ, dataPublicacao: '2026-09-02',
    conteudo: 'Fica a parte intimada a apresentar contestação no prazo de quinze dias.' });
  assert.equal(s.dias, 15);
  assert.equal(s.tipo, 'contestacao');
});
teste('respeita contagem em dias úteis declarada no texto', () => {
  const s = interpretarPublicacao({ numeroCNJ: processo.numeroCNJ, dataPublicacao: '2026-09-02',
    conteudo: 'Apresente rol de testemunhas no prazo de 5 (cinco) dias úteis.' });
  assert.equal(s.contagem, 'uteis');
  assert.equal(s.dias, 5);
});
teste('alerta quando o processo não está cadastrado', () => {
  const s = interpretarPublicacao({ numeroCNJ: '0000000-00.2026.8.17.9999',
    dataPublicacao: '2026-09-02', conteudo: 'Manifeste-se no prazo de 15 dias.' });
  assert.equal(s.processoId, null);
  assert.ok(s.alertas.some((a) => /não localizado/i.test(a)));
});
teste('confiança é menor quando faltam elementos', () => {
  const completa = interpretarPublicacao({ numeroCNJ: processo.numeroCNJ,
    conteudo: 'Manifeste-se no prazo de 15 dias úteis.', dataPublicacao: '2026-09-02' });
  const incompleta = interpretarPublicacao({ numeroCNJ: '0000000-00.2026.8.17.9999',
    conteudo: 'Cumpra-se.', dataPublicacao: '2026-09-02' });
  assert.ok(completa.confianca > incompleta.confianca);
});

console.log('\nPrevenção de erros');
teste('alerta prazo já cadastrado na mesma data', () => {
  const existente = db.listar('prazos').find((p) => p.status === 'pendente');
  const avisos = conflitosDePrazo({ processoId: existente.processoId, tipo: 'outros',
    dataVencimento: existente.dataVencimento });
  assert.ok(avisos.some((a) => /Já existe prazo cadastrado/.test(a.texto)));
});
teste('alerta outro prazo pendente do mesmo tipo', () => {
  const existente = db.listar('prazos').find((p) => p.status === 'pendente');
  const avisos = conflitosDePrazo({ processoId: existente.processoId, tipo: existente.tipo,
    dataVencimento: addDays(existente.dataVencimento, 5) });
  assert.ok(avisos.some((a) => /mesmo tipo/.test(a.texto)));
});
teste('alerta vencimento no passado', () => {
  const avisos = conflitosDePrazo({ processoId: processo.id, tipo: 'outros',
    dataVencimento: addDays(hoje(), -1) });
  assert.ok(avisos.some((a) => /já passou/.test(a.texto)));
});
teste('exclusão é lógica e recuperável', () => {
  const t = db.inserir('tarefas', { titulo: 'Teste de exclusão', status: 'pendente' });
  db.remover('tarefas', t.id, 'teste');
  assert.equal(db.listar('tarefas').some((x) => x.id === t.id), false);
  db.restaurar('tarefas', t.id);
  assert.equal(db.listar('tarefas').some((x) => x.id === t.id), true);
  db.removerDefinitivo('tarefas', t.id);
});
teste('toda alteração fica registrada na auditoria', () => {
  const antes = db.listar('auditoria', { incluirExcluidos: true }).length;
  const c = db.inserir('clientes', { nome: 'Cliente de teste' });
  db.atualizar('clientes', c.id, { nome: 'Cliente renomeado' });
  const depois = db.listar('auditoria', { incluirExcluidos: true }).length;
  assert.equal(depois, antes + 2);
  db.removerDefinitivo('clientes', c.id);
});

console.log('\nPainel e agenda');
teste('indicadores refletem a base', () => {
  const i = indicadores();
  assert.ok(i.processosAtivos >= 3);
  assert.ok(i.publicacoesPendentes >= 2);
  assert.ok(i.vencidos >= 1);
});
teste('agenda reúne prazos, tarefas e audiências', () => {
  const eventos = eventosAgenda({ de: addDays(hoje(), -30), ate: addDays(hoje(), 30) });
  const tipos = new Set(eventos.map((e) => e.tipoRegistro));
  assert.ok(tipos.has('prazo') && tipos.has('tarefa') && tipos.has('audiencia'));
});
teste('filtro por tipo funciona', () => {
  const so = eventosAgenda({ de: addDays(hoje(), -30), ate: addDays(hoje(), 30), filtros: { tipo: 'prazos' } });
  assert.ok(so.every((e) => e.tipoRegistro === 'prazo'));
});
teste('linha do tempo do processo é cronológica e decrescente', () => {
  const t = linhaDoTempo(processo.id);
  assert.ok(t.length > 0);
  for (let i = 1; i < t.length; i += 1) assert.ok(t[i - 1].data >= t[i].data);
});

console.log('\nRelatório do cliente');
teste('gera texto em linguagem acessível', () => {
  const r = relatorioCliente(db.listar('clientes')[0].id);
  assert.ok(r.texto.includes('RELATÓRIO PROCESSUAL'));
  assert.ok(/Situação atual:/.test(r.texto));
  assert.ok(/Próxima providência:/.test(r.texto));
});

console.log(`\n${passou} verificações concluídas.`);
