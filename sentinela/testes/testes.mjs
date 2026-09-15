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
const { interpretarPublicacao, relatorioCliente, analisarAndamento, novidadesDoProcesso,
  relatorioProcessual } = await import('../src/core/ia.js');
const { conflitosDePrazo, indicadores, eventosAgenda, linhaDoTempo } = await import('../src/core/dominio.js');
const { arquivadoEmDefinitivo, interpretarListaProcessos, tribunais, oabsMonitoradas,
  publicacoes: servicoPublicacoes } = await import('../src/core/integracoes.js');
const { agruparEmProcessos, comunicacaoComoPublicacao, consultarPorOAB, BASE_PADRAO, parsearOAB } =
  await import('../src/core/djen.js');
const { definirPonte: definirPonteInicial } = await import('../src/core/ponte.js');
definirPonteInicial(false); // consultas diretas, salvo onde o teste disser o contrário

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

console.log('\nPublicação apurada a partir da disponibilização');
teste('disponibilização na sexta publica na segunda', () => {
  // 11/09/2026 é sexta-feira.
  const r = calcularPrazo({ dataDisponibilizacao: '2026-09-11', dias: 15, contagem: 'uteis' });
  assert.equal(r.dataPublicacao, '2026-09-14');
  assert.equal(r.inicio, '2026-09-15');
});
teste('disponibilização em dia útil publica no dia seguinte', () => {
  const r = calcularPrazo({ dataDisponibilizacao: '2026-09-09', dias: 15, contagem: 'uteis' });
  assert.equal(r.dataPublicacao, '2026-09-10');
});
teste('calcula sem que a publicação seja informada', () => {
  const r = calcularPrazo({ dataDisponibilizacao: '2026-09-11', dias: 5, contagem: 'uteis' });
  assert.ok(!r.erro);
  assert.ok(r.vencimento > r.inicio);
});

console.log('\nLeitura de despachos e decisões');
teste('identifica decisão, deferimento e prazo aberto', () => {
  const r = analisarAndamento('Defiro a tutela de urgência. Manifeste-se a parte ré no prazo de 15 dias.');
  assert.equal(r.natureza, 'decisão');
  assert.equal(r.dias, 15);
  assert.ok(r.determinacoes.includes('o pedido de tutela de urgência foi deferido'));
});
teste('não confunde indeferimento com deferimento', () => {
  const r = analisarAndamento('Indefiro a liminar requerida.');
  assert.ok(r.determinacoes.includes('o pedido de tutela de urgência foi indeferido'));
  assert.ok(!r.determinacoes.includes('o pedido de tutela de urgência foi deferido'));
});
teste('reconhece sentença de procedência', () => {
  const r = analisarAndamento('Julgo procedente o pedido e condeno a ré.');
  assert.equal(r.natureza, 'sentença');
  assert.ok(/julgado procedente/.test(r.resumo));
});
teste('designação de audiência não se repete na descrição', () => {
  const r = analisarAndamento('Designo audiência de conciliação para 20/10/2026.');
  assert.equal(r.resumo, 'Foi designada audiência para 20/10/2026.');
});
teste('texto sem conteúdo jurídico não gera descrição inventada', () => {
  const r = analisarAndamento('Documento ilegível recebido.');
  assert.equal(r.confiavel, false);
  assert.equal(r.resumo, '');
});

console.log('\nRelatório processual');
teste('apura as movimentações do processo', () => {
  const v = novidadesDoProcesso(processo.id, { desde: addDays(hoje(), -365) });
  assert.ok(v.itens.length > 0);
  assert.ok(v.itens.every((i) => i.data && i.origem));
});
teste('monta relatório com as movimentações do período', () => {
  const r = relatorioProcessual({ clienteId: processo.clienteId, desde: addDays(hoje(), -365) });
  assert.equal(r.vazio, false);
  assert.ok(r.texto.includes('RELATÓRIO PROCESSUAL'));
  assert.ok(r.texto.includes('Movimentações do período:'));
});
teste('cliente sem processo ativo não gera relatório vazio de conteúdo', () => {
  const r = relatorioProcessual({ clienteId: 'inexistente' });
  assert.equal(r.vazio, true);
  assert.equal(r.texto, '');
});

console.log('\nLinha do tempo');
teste('cada registro informa a origem', () => {
  const t = linhaDoTempo(processo.id);
  const comOrigem = t.filter((i) => i.origem);
  assert.ok(comOrigem.length > 0);
  assert.ok(comOrigem.some((i) => i.tipo === 'movimentacao'));
});
teste('movimentação lançada à mão entra na linha do tempo e é editável', () => {
  const m = db.inserir('movimentacoes', { processoId: processo.id, data: hoje(),
    titulo: 'Conclusos para sentença', descricao: 'Autos conclusos.', origem: 'manual' });
  const item = linhaDoTempo(processo.id).find((i) => i.registroId === m.id);
  assert.ok(item);
  assert.equal(item.origem, 'manual');
  assert.equal(item.editavel, true);
});

console.log('\nConsulta processual pela OAB');

/** Monta um número CNJ válido para os casos de teste. */
const cnjValido = (sequencial) => {
  const base = `${String(sequencial).padStart(7, '0')}2026819000100`;
  let resto = 0;
  for (const ch of base) resto = (resto * 10 + Number(ch)) % 97;
  const dv = String(98 - resto).padStart(2, '0');
  return `${String(sequencial).padStart(7, '0')}${dv}20268190001`;
};

teste('baixa definitiva é reconhecida', () => {
  assert.equal(arquivadoEmDefinitivo({ situacao: 'Arquivado definitivamente' }), true);
  assert.equal(arquivadoEmDefinitivo({ situacao: 'Baixa definitiva' }), true);
});
teste('arquivamento provisório e suspensão não são descartados', () => {
  assert.equal(arquivadoEmDefinitivo({ situacao: 'Arquivado provisoriamente' }), false);
  assert.equal(arquivadoEmDefinitivo({ situacao: 'Suspenso' }), false);
  assert.equal(arquivadoEmDefinitivo({ situacao: 'Em andamento' }), false);
});
teste('lista colada é lida com e sem colunas', () => {
  const lista = interpretarListaProcessos(
    `${fmtCNJ(cnjValido(101))}\n`
    + `${fmtCNJ(cnjValido(102))};Procedimento Comum;Cobrança;1ª Vara;TJPE;Em andamento\n`
    + 'linha sem processo algum');
  assert.equal(lista.length, 2);
  assert.equal(lista[1].classe, 'Procedimento Comum');
  assert.equal(lista[1].situacao, 'Em andamento');
});
teste('importa apenas os processos ativos', () => {
  const r = tribunais.importar([
    { numeroCNJ: cnjValido(201), classe: 'Procedimento Comum', situacao: 'Em andamento' },
    { numeroCNJ: cnjValido(202), classe: 'Execução', situacao: 'Arquivado definitivamente' },
    { numeroCNJ: cnjValido(203), classe: 'Monitória', situacao: 'Arquivado provisoriamente' },
    { numeroCNJ: '123', situacao: 'Em andamento' },
  ]);
  assert.equal(r.importados.length, 2);
  assert.equal(r.arquivados.length, 1);
  assert.equal(r.invalidos.length, 1);
  assert.ok(r.importados.every((p) => p.status === 'ativo'));
});
teste('não duplica processo já cadastrado', () => {
  const r = tribunais.importar([{ numeroCNJ: cnjValido(201), situacao: 'Em andamento' }]);
  assert.equal(r.importados.length, 0);
  assert.equal(r.duplicados.length, 1);
});
// O executor de testes é síncrono, e nenhum teste toca a rede: a consulta é
// resolvida com o serviço simulado antes de asseverar.
const restaurarFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('nenhum teste deve chamar a rede'); };
const semOAB = await tribunais.consultarPorOAB({ oab: '', uf: 'PE' });
globalThis.fetch = restaurarFetch;

teste('consulta sem OAB informada é recusada antes de qualquer chamada', () => {
  assert.equal(semOAB.disponivel, false);
  assert.match(semOAB.motivo, /OAB/);
  assert.equal(semOAB.processos.length, 0);
});
teste('processo importado aguarda vínculo com o cliente', () => {
  const importado = db.listar('processos').find((p) => p.origem === 'consulta processual');
  assert.ok(importado);
  assert.equal(importado.clienteId, null);
  assert.equal(importado.pendenteVinculoCliente, true);
});

console.log('\nConsulta pública do CNJ (DJEN)');

/** Comunicação no formato que o serviço do CNJ devolve. */
const comunicacao = (numero, data, texto, extra = {}) => ({
  id: Math.random(), numero_processo: numero, data_disponibilizacao: data, texto,
  siglaTribunal: 'TJPE', nomeOrgao: '1ª Vara Cível', nomeClasse: 'Procedimento Comum',
  tipoComunicacao: 'Intimação', ...extra,
});

teste('agrupa comunicações por processo e guarda a mais recente', () => {
  const g = agruparEmProcessos([
    comunicacao(cnjValido(301), '2026-03-02', 'Despacho inicial.'),
    comunicacao(cnjValido(301), '2026-07-20', 'Sentença publicada.'),
    comunicacao(cnjValido(302), '2026-05-10', 'Intime-se.'),
  ]);
  assert.equal(g.length, 2);
  const primeiro = g.find((p) => p.numeroCNJ === cnjValido(301));
  assert.equal(primeiro.comunicacoes, 2);
  assert.equal(primeiro.ultimaData, '2026-07-20');
  assert.equal(primeiro.ultimoMovimento, 'Sentença publicada.');
  assert.equal(primeiro.tribunal, 'TJPE');
});
teste('descarta comunicação sem número CNJ válido', () => {
  assert.equal(agruparEmProcessos([comunicacao('123', '2026-05-10', 'x')]).length, 0);
});
teste('aceita data em formato brasileiro', () => {
  const g = agruparEmProcessos([comunicacao(cnjValido(303), '10/05/2026', 'Intime-se.')]);
  assert.equal(g[0].ultimaData, '2026-05-10');
});
teste('converte comunicação em publicação do sistema', () => {
  const pub = comunicacaoComoPublicacao(comunicacao(cnjValido(304), '2026-05-10', 'Prazo de 15 dias.'));
  assert.equal(pub.numeroCNJ, cnjValido(304));
  assert.equal(pub.dataDisponibilizacao, '2026-05-10');
  assert.equal(pub.origem, 'DJEN');
  assert.match(pub.diario, /DJEN/);
});
teste('processo com baixa definitiva na última comunicação é descartado', () => {
  const g = agruparEmProcessos([
    comunicacao(cnjValido(305), '2026-01-10', 'Cite-se.'),
    comunicacao(cnjValido(305), '2026-08-01', 'Arquivem-se os autos com baixa definitiva.'),
  ]);
  assert.equal(arquivadoEmDefinitivo(g[0]), true);
});

// A consulta é exercitada com o serviço simulado, sem tocar a rede.
const fetchOriginal = globalThis.fetch;
const simular = (resposta) => { globalThis.fetch = async () => resposta; };
const respostaJSON = (corpo, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => corpo,
});

const recusaSemOab = await consultarPorOAB({ numeroOab: '', ufOab: 'PE' });
const recusaSemUf = await consultarPorOAB({ numeroOab: '12345', ufOab: '' });
simular(respostaJSON({ count: 1, items: [comunicacao(cnjValido(306), '2026-06-01', 'Intime-se.')] }));
const sucesso = await consultarPorOAB({ numeroOab: '12.345', ufOab: 'pe' });
simular(respostaJSON({}, 403));
const bloqueio = await consultarPorOAB({ numeroOab: '12345', ufOab: 'PE' });
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
const semRede = await consultarPorOAB({ numeroOab: '12345', ufOab: 'PE' });
globalThis.fetch = fetchOriginal;

teste('recusa consulta sem OAB ou sem seccional', () => {
  assert.equal(recusaSemOab.ok, false);
  assert.match(recusaSemOab.motivo, /OAB/);
  assert.equal(recusaSemUf.ok, false);
  assert.match(recusaSemUf.motivo, /seccional/i);
});
teste('lê as comunicações devolvidas pelo serviço', () => {
  assert.equal(sucesso.ok, true);
  assert.equal(sucesso.comunicacoes.length, 1);
  assert.equal(sucesso.total, 1);
});
teste('bloqueio geográfico é explicado, não mascarado', () => {
  assert.equal(bloqueio.ok, false);
  assert.match(bloqueio.motivo, /403/);
  assert.match(bloqueio.motivo, /Brasil/);
});
teste('falha de origem no navegador é explicada', () => {
  assert.equal(semRede.ok, false);
  assert.match(semRede.motivo, /origem|servidor/i);
});
teste('endereço padrão é o do serviço público do CNJ', () => {
  assert.equal(BASE_PADRAO, 'https://comunicaapi.pje.jus.br/api/v1');
});

console.log('\nPublicações a partir da consulta pública');

teste('lê a inscrição escrita de formas diferentes', () => {
  assert.deepEqual(parsearOAB('OAB/PE 12345'), { numero: '12345', uf: 'PE' });
  assert.deepEqual(parsearOAB('12345/PE'), { numero: '12345', uf: 'PE' });
  assert.deepEqual(parsearOAB('SP 987654'), { numero: '987654', uf: 'SP' });
  assert.equal(parsearOAB('12345'), null);
  assert.equal(parsearOAB(''), null);
});

// Cenários de consulta resolvidos antes de asseverar, com o serviço simulado.
const fetchAntes = globalThis.fetch;
const usuariosAntes = db.listar('usuarios').map((u) => ({ id: u.id, oab: u.oab }));
usuariosAntes.forEach((u) => db.atualizar('usuarios', u.id, { oab: '' }));
db.salvarConfig({ integracoes: { ...db.config().integracoes,
  publicacoes: { ...db.config().integracoes.publicacoes, oabs: '', ultimaConsulta: null } } });

globalThis.fetch = async () => { throw new Error('não deve consultar sem inscrição'); };
const semInscricao = await servicoPublicacoes.consultar();

db.atualizar('usuarios', usuariosAntes[0].id, { oab: 'OAB/PE 12345' });
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({ count: 1, items: [{
    id: 9001, numero_processo: cnjValido(501), data_disponibilizacao: '2026-09-10',
    siglaTribunal: 'TJPE', nomeOrgao: '1ª Vara', texto: 'Intime-se no prazo de 15 dias.',
  }] }),
});
const comInscricao = await servicoPublicacoes.consultar({ de: '2026-09-01', ate: '2026-09-15' });

globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
const bloqueada = await servicoPublicacoes.consultar({ de: '2026-09-01', ate: '2026-09-15' });
globalThis.fetch = fetchAntes;

teste('a inscrição do usuário alimenta a consulta quando nada é configurado', () => {
  const lista = oabsMonitoradas();
  assert.ok(lista.some((i) => i.numero === '12345' && i.uf === 'PE'));
});
teste('inscrições configuradas têm precedência e não se repetem', () => {
  db.salvarConfig({ integracoes: { ...db.config().integracoes,
    publicacoes: { ...db.config().integracoes.publicacoes, oabs: '111/PE, 111/PE, 222/SP' } } });
  const lista = oabsMonitoradas();
  assert.deepEqual(lista, [{ numero: '111', uf: 'PE' }, { numero: '222', uf: 'SP' }]);
  db.salvarConfig({ integracoes: { ...db.config().integracoes,
    publicacoes: { ...db.config().integracoes.publicacoes, oabs: '' } } });
});
teste('sem inscrição a consulta diz o que falta e nada busca', () => {
  assert.equal(semInscricao.semOAB, true);
  assert.equal(semInscricao.importadas, 0);
  assert.match(semInscricao.mensagem, /inscri[çc][ãa]o/i);
});
teste('consulta traz a intimação como publicação para conferência', () => {
  assert.equal(comInscricao.importadas, 1);
  const pub = db.listar('publicacoes').find((x) => x.numeroCNJ === cnjValido(501));
  assert.ok(pub);
  assert.equal(pub.origem, 'DJEN');
  assert.equal(pub.status, 'pendente');
  assert.equal(pub.sugestao.dias, 15);
});
teste('falha de comunicação não é lida como ausência de intimação', () => {
  assert.equal(bloqueada.erro, true);
  assert.equal(bloqueada.importadas, 0);
  assert.match(bloqueada.mensagem, /403|Brasil/);
});

console.log('\nArquivamento e exclusão de processo');

const { dependenciasDoProcesso, arquivarProcesso, reativarProcesso, excluirProcesso } =
  await import('../src/core/dominio.js');

const processoParaArquivar = db.inserir('processos', {
  numeroCNJ: cnjValido(701), clienteId: processo.clienteId, status: 'ativo', tribunal: 'TJPE',
});
db.inserir('prazos', { processoId: processoParaArquivar.id, tipo: 'manifestacao',
  status: 'pendente', dataVencimento: addDays(hoje(), 10) });
db.inserir('tarefas', { processoId: processoParaArquivar.id, titulo: 'Juntar procuração' });

teste('conta o que está vinculado ao processo', () => {
  const d = dependenciasDoProcesso(processoParaArquivar.id);
  assert.equal(d.contagem.prazos, 1);
  assert.equal(d.contagem.tarefas, 1);
  assert.equal(d.prazosAbertos, 1);
  assert.equal(d.total, 2);
});
teste('arquivar cancela os prazos em aberto e preserva o histórico', () => {
  const r = arquivarProcesso(processoParaArquivar.id, { motivo: 'Trânsito em julgado' });
  assert.equal(r.prazosCancelados, 1);
  const p = db.obter('processos', processoParaArquivar.id);
  assert.equal(p.status, 'arquivado');
  assert.equal(p.motivoEncerramento, 'Trânsito em julgado');
  assert.equal(db.listar('prazos', { processoId: p.id })[0].status, 'cancelado');
  // Nada foi apagado: tarefa e prazo seguem consultáveis.
  assert.equal(db.listar('tarefas', { processoId: p.id }).length, 1);
});
teste('reabrir devolve o processo à operação', () => {
  reativarProcesso(processoParaArquivar.id);
  const p = db.obter('processos', processoParaArquivar.id);
  assert.equal(p.status, 'ativo');
  assert.equal(p.motivoEncerramento, null);
});

const processoErrado = db.inserir('processos', {
  numeroCNJ: cnjValido(702), clienteId: processo.clienteId, status: 'ativo',
});
db.inserir('prazos', { processoId: processoErrado.id, tipo: 'outros',
  status: 'pendente', dataVencimento: addDays(hoje(), 5) });
db.inserir('movimentacoes', { processoId: processoErrado.id, data: hoje(), titulo: 'Distribuição' });

teste('excluir leva os vínculos junto, sem deixar prazo órfão', () => {
  const r = excluirProcesso(processoErrado.id, 'Cadastro em duplicidade');
  assert.equal(r.total, 2);
  assert.equal(db.obter('processos', processoErrado.id), null);
  assert.equal(db.listar('prazos', { processoId: processoErrado.id }).length, 0);
  assert.equal(db.listar('movimentacoes', { processoId: processoErrado.id }).length, 0);
});
teste('exclusão é lógica e permanece recuperável', () => {
  const excluidos = db.listar('processos', { incluirExcluidos: true })
    .filter((p) => p.id === processoErrado.id);
  assert.equal(excluidos.length, 1);
  assert.ok(excluidos[0].excluidoEm);
  assert.equal(excluidos[0].motivoExclusao, 'Cadastro em duplicidade');
  db.restaurar('processos', processoErrado.id);
  assert.ok(db.obter('processos', processoErrado.id));
});
teste('registro excluído não é devolvido por obter, mas continua na lixeira', () => {
  const alvo = db.inserir('tarefas', { titulo: 'Tarefa a excluir' });
  db.remover('tarefas', alvo.id, 'teste');
  assert.equal(db.obter('tarefas', alvo.id), null);
  assert.ok(db.obter('tarefas', alvo.id, { incluirExcluidos: true }));
  assert.ok(db.listar('tarefas', { incluirExcluidos: true }).some((x) => x.id === alvo.id));
});
teste('excluir processo inexistente é recusado', () => {
  assert.throws(() => excluirProcesso('nao-existe'), /não encontrado/i);
});

console.log('\nAcesso: alteração e recuperação');

const { registrarConta, alterarAcesso, recuperarComCodigo, autenticar, gerarCodigoRecuperacao,
  usuarioAtual, sair } = await import('../src/core/auth.js');

// Base limpa de usuários para exercitar o ciclo de acesso do começo.
db.listar('usuarios').forEach((u) => db.removerDefinitivo('usuarios', u.id));
const conta = await registrarConta({
  nome: 'Bruno Omena Cabral', email: 'Bruno@Adv.BR', senha: 'senhaInicial1', oab: '12345/PE',
});

teste('criar conta entrega código de recuperação e normaliza o e-mail', () => {
  assert.match(conta.codigoRecuperacao, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  assert.equal(conta.email, 'bruno@adv.br');
  // O código não fica legível na base: guarda-se apenas o resumo.
  assert.ok(conta.codigoRecuperacaoHash);
  assert.ok(!JSON.stringify(db.obter('usuarios', conta.id)).includes(conta.codigoRecuperacao));
});
teste('código de recuperação não se repete', () => {
  assert.notEqual(gerarCodigoRecuperacao(), gerarCodigoRecuperacao());
});

const trocaSemSenha = await alterarAcesso({ email: 'novo@adv.br', senhaAtual: 'errada12345' })
  .then(() => null).catch((e) => e);
const trocaEmail = await alterarAcesso({ email: 'novo@adv.br', senhaAtual: 'senhaInicial1' });
const trocaSenha = await alterarAcesso({ email: 'novo@adv.br', senhaAtual: 'senhaInicial1',
  senhaNova: 'senhaTrocada1' });

teste('senha atual incorreta impede a alteração', () => {
  assert.ok(trocaSemSenha instanceof Error);
  assert.match(trocaSemSenha.message, /senha atual/i);
});
teste('troca o e-mail de acesso', () => {
  assert.equal(trocaEmail.email, 'novo@adv.br');
});
const senhaAntiga = await autenticar('novo@adv.br', 'senhaInicial1')
  .then(() => null).catch((e) => e);
teste('troca a senha e a antiga deixa de valer', () => {
  assert.ok(trocaSenha);
  assert.ok(senhaAntiga instanceof Error);
});

const entradaNova = await autenticar('novo@adv.br', 'senhaTrocada1');
teste('entra com a senha nova', () => {
  assert.equal(entradaNova.email, 'novo@adv.br');
});

const codigoErrado = await recuperarComCodigo('novo@adv.br', 'AAAA-BBBB-CCCC-DDDD', 'outraSenha1')
  .then(() => null).catch((e) => e);
const recuperado = await recuperarComCodigo('novo@adv.br', conta.codigoRecuperacao, 'senhaDoCodigo1');

teste('código incorreto não redefine a senha', () => {
  assert.ok(codigoErrado instanceof Error);
  assert.match(codigoErrado.message, /código/i);
});
teste('código correto redefine a senha e já autentica', () => {
  assert.ok(recuperado);
  assert.equal(usuarioAtual().email, 'novo@adv.br');
});
const senhaCurta = await recuperarComCodigo('novo@adv.br', conta.codigoRecuperacao, 'abc')
  .then(() => null).catch((e) => e);
teste('senha curta é recusada na recuperação', () => {
  assert.ok(senhaCurta instanceof Error);
  assert.match(senhaCurta.message, /8 caracteres/);
});

console.log('\nConsulta de movimentos ao tribunal (DataJud)');

const { indiceDoProcesso, movimentoComoRegistro, consultarProcesso, INDICES } =
  await import('../src/core/datajud.js');
const { atualizarPeloTribunal } = await import('../src/core/integracoes.js');

teste('deduz o índice do tribunal pelo número do processo', () => {
  assert.equal(indiceDoProcesso({ numeroCNJ: '0000101-08.2026.8.17.0001' }), 'tjpe');
  assert.equal(indiceDoProcesso({ numeroCNJ: '1000000-00.2024.8.26.0100' }), 'tjsp');
  assert.equal(indiceDoProcesso({ numeroCNJ: '0000001-00.2024.8.07.0001' }), 'tjdft');
  assert.equal(indiceDoProcesso({ numeroCNJ: '00008323520184013202' }), 'trf1');
  assert.equal(indiceDoProcesso({ numeroCNJ: '0000001-00.2024.5.06.0001' }), 'trt6');
});
teste('a sigla informada no cadastro tem precedência sobre o número', () => {
  assert.equal(indiceDoProcesso({ numeroCNJ: '0000101-08.2026.8.17.0001', tribunal: 'TJSP' }), 'tjsp');
});
teste('número inválido não produz índice', () => {
  assert.equal(indiceDoProcesso({ numeroCNJ: '123' }), null);
  assert.ok(INDICES.includes('tjpe') && INDICES.includes('trt24'));
});
teste('movimento do tribunal vira registro da linha do tempo', () => {
  const r = movimentoComoRegistro({
    codigo: 970, nome: 'Audiência', dataHora: '2026-03-10T14:06:24.000Z',
    complementosTabelados: [{ nome: 'designada' }, { nome: 'conciliação' }],
  }, { tribunal: 'TJPE' });
  assert.equal(r.data, '2026-03-10');
  assert.equal(r.titulo, 'Audiência');
  assert.equal(r.descricao, 'designada · conciliação');
  assert.equal(r.origem, 'andamento processual');
  assert.match(r.chaveExterna, /^datajud:TJPE:970:/);
});

// O serviço é simulado: nenhum teste toca a rede.
const fetchDataJud = globalThis.fetch;
const respostaDataJud = (movimentos, extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ hits: { hits: [{ _source: {
    numeroProcesso: '00001010820268170001', tribunal: 'TJPE', grau: 'G1',
    classe: { nome: 'Procedimento Comum Cível' },
    assuntos: [{ nome: 'Rescisão do contrato' }],
    orgaoJulgador: { nome: '3ª Vara Cível do Recife' },
    dataAjuizamento: '20260115000000',
    dataHoraUltimaAtualizacao: '2026-09-10T10:00:00.000Z',
    movimentos, ...extra,
  } }] } }),
});

const MOVIMENTOS = [
  { codigo: 26, nome: 'Distribuição', dataHora: '2026-01-15T09:00:00.000Z' },
  { codigo: 581, nome: 'Documento', dataHora: '2026-02-02T11:00:00.000Z',
    complementosTabelados: [{ nome: 'Petição inicial' }] },
  { codigo: 970, nome: 'Audiência', dataHora: '2026-03-10T14:00:00.000Z',
    complementosTabelados: [{ nome: 'designada' }] },
  { codigo: 999, nome: 'Sem data', dataHora: null },
];

const processoManual = db.inserir('processos', {
  numeroCNJ: '00001010820268170001', clienteId: processo.clienteId, status: 'ativo',
});

globalThis.fetch = async () => respostaDataJud(MOVIMENTOS);
const primeira = await atualizarPeloTribunal(processoManual.id);
const segunda = await atualizarPeloTribunal(processoManual.id);

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ hits: { hits: [] } }) });
const semResultado = await atualizarPeloTribunal(processoManual.id);

globalThis.fetch = async () => ({ ok: false, status: 404,
  json: async () => ({}), text: async () => '{"error":"index_not_found_exception"}' });
const indiceInexistente = await consultarProcesso({ numeroCNJ: '00001010820268170001', indice: 'tjpe' });

globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
const bloqueioOrigem = await consultarProcesso({ numeroCNJ: '00001010820268170001', indice: 'tjpe' });
globalThis.fetch = fetchDataJud;

teste('importa os movimentos do tribunal, descartando os sem data', () => {
  assert.equal(primeira.ok, true);
  assert.equal(primeira.importados, 3);
  assert.equal(primeira.total, 3);
  const linha = linhaDoTempo(processoManual.id).filter((i) => i.tipo === 'movimentacao');
  assert.equal(linha.length, 3);
  assert.ok(linha.every((i) => i.origem === 'andamento processual'));
});
teste('consulta repetida não duplica movimento já importado', () => {
  assert.equal(segunda.importados, 0);
  assert.equal(segunda.repetidos, 3);
  assert.equal(db.listar('movimentacoes', { processoId: processoManual.id }).length, 3);
});
teste('a capa em branco é complementada pela consulta', () => {
  const p = db.obter('processos', processoManual.id);
  assert.equal(p.tribunal, 'TJPE');
  assert.equal(p.vara, '3ª Vara Cível do Recife');
  assert.equal(p.classe, 'Procedimento Comum Cível');
  assert.equal(p.dataDistribuicao, '2026-01-15');
  assert.ok(primeira.complementados.includes('tribunal'));
});
teste('processo ausente da base pública é informado, não silenciado', () => {
  assert.equal(semResultado.ok, false);
  assert.match(semResultado.motivo, /segredo de justiça|Nenhum processo encontrado/i);
});
teste('índice inexistente e bloqueio de origem são explicados', () => {
  assert.equal(indiceInexistente.ok, false);
  assert.match(indiceInexistente.motivo, /índice do tribunal/i);
  assert.equal(bloqueioOrigem.ok, false);
  assert.match(bloqueioOrigem.motivo, /origem|servidor/i);
});
teste('os movimentos importados alimentam o relatório processual', () => {
  const r = relatorioProcessual({ clienteId: processoManual.clienteId,
    processoId: processoManual.id, desde: '2026-01-01' });
  assert.equal(r.vazio, false);
  assert.match(r.texto, /Movimentações do período:/);
  assert.match(r.texto, /Audiência|Distribuição/);
});

console.log('\nPonte de consultas na origem');

const { detectarPonte, definirPonte, ponteDisponivel, pontePronta } =
  await import('../src/core/ponte.js');
const { baseEmUso: baseDataJud, BASE_PADRAO: BASE_DATAJUD } = await import('../src/core/datajud.js');
const { baseEmUso: baseDJEN, BASE_PADRAO: BASE_DJEN } = await import('../src/core/djen.js');

const fetchPonte = globalThis.fetch;

definirPonte(null);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, servicos: ['datajud'] }) });
const comPonte = await detectarPonte();
const baseComPonte = { datajud: baseDataJud(), djen: baseDJEN() };

definirPonte(null);
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
const semPonte = await detectarPonte();
const baseSemPonte = { datajud: baseDataJud(), djen: baseDJEN() };

definirPonte(null);
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const ponte404 = await detectarPonte();
globalThis.fetch = fetchPonte;

teste('ponte encontrada passa a ser o caminho das consultas', () => {
  assert.equal(comPonte, true);
  assert.equal(baseComPonte.datajud, '/api/datajud');
  assert.equal(baseComPonte.djen, '/api/djen');
});
teste('sem ponte, o endereço volta a ser o do serviço público', () => {
  assert.equal(semPonte, false);
  assert.equal(baseSemPonte.datajud, BASE_DATAJUD);
  assert.equal(baseSemPonte.djen, BASE_DJEN);
});
teste('hospedagem sem a rota da ponte não é tratada como ponte', () => {
  assert.equal(ponte404, false);
  assert.equal(ponteDisponivel(), false);
  assert.equal(pontePronta(), true);
});
console.log('\nContrato do repasse de consultas');

const { usandoRepasse } = await import('../src/core/datajud.js');
const fetchRepasse = globalThis.fetch;
let ultimaChamada = null;

const capturar = (corpoResposta = { hits: { hits: [] } }, status = 200) => async (url, opcoes) => {
  ultimaChamada = { url, opcoes };
  return { ok: status < 300, status,
    json: async () => corpoResposta,
    text: async () => JSON.stringify(corpoResposta) };
};

definirPonte(true);
globalThis.fetch = capturar();
await consultarProcesso({ numeroCNJ: '00001010820268170001', indice: 'tjpe' });
const porPonte = ultimaChamada;

definirPonte(false);
globalThis.fetch = capturar();
await consultarProcesso({ numeroCNJ: '00001010820268170001', indice: 'tjpe' });
const direta = ultimaChamada;

definirPonte(true);
globalThis.fetch = capturar();
await consultarPorOAB({ numeroOab: '12345', ufOab: 'PE' });
const djenPorPonte = ultimaChamada;

// Rota de repasse ausente devolve página de erro, não JSON.
definirPonte(true);
globalThis.fetch = async () => ({ ok: false, status: 404,
  json: async () => ({}), text: async () => '<!DOCTYPE html><title>404</title>' });
const pontefaltando = await consultarProcesso({ numeroCNJ: '00001010820268170001', indice: 'tjpe' });

definirPonte(false);
globalThis.fetch = async () => ({ ok: false, status: 404,
  json: async () => ({}), text: async () => '{"error":"index_not_found"}' });
const indiceAusente = await consultarProcesso({ numeroCNJ: '00001010820268170001', indice: 'tjxx' });
globalThis.fetch = fetchRepasse;
definirPonte(false);

teste('pelo repasse vão apenas o índice e o número, sem a chave', () => {
  assert.equal(porPonte.url, '/api/datajud');
  const corpo = JSON.parse(porPonte.opcoes.body);
  assert.deepEqual(corpo, { indice: 'tjpe', numeroProcesso: '00001010820268170001' });
  assert.equal(porPonte.opcoes.headers.Authorization, undefined);
});
teste('na chamada direta o cliente monta a requisição e leva a chave pública', () => {
  assert.match(direta.url, /api-publica\.datajud\.cnj\.jus\.br\/api_publica_tjpe\/_search$/);
  assert.match(direta.opcoes.headers.Authorization, /^APIKey /);
  assert.ok(JSON.parse(direta.opcoes.body).query.match.numeroProcesso);
});
teste('o DJEN pelo repasse usa a própria rota, sem duplicar o recurso', () => {
  assert.ok(djenPorPonte.url.startsWith('/api/djen?'), djenPorPonte.url);
  assert.ok(!djenPorPonte.url.includes('/comunicacao'));
});
teste('ponte ausente não é confundida com índice inexistente', () => {
  assert.equal(pontefaltando.ok, false);
  assert.match(pontefaltando.motivo, /ponte de consultas/i);
  assert.equal(indiceAusente.ok, false);
  assert.match(indiceAusente.motivo, /índice do tribunal/i);
});
teste('o modo de repasse acompanha a ponte', () => {
  definirPonte(true);
  assert.equal(usandoRepasse(), true);
  definirPonte(false);
  assert.equal(usandoRepasse(), false);
});

console.log('\nTeor dos atos decisórios');

const { ehAtoDecisorio } = await import('../src/core/datajud.js');
const { acoplarTeor } = await import('../src/core/integracoes.js');

// Pares código/nome levantados dos movimentos reais devolvidos pelo DataJud.
teste('reconhece os atos decisórios pelo código da tabela do CNJ', () => {
  for (const [codigo, nome] of [[11010, 'Mero expediente'], [12164, 'Outras Decisões'],
    [3, 'Decisão'], [219, 'Procedência'], [220, 'Improcedência'], [221, 'Procedência em Parte'],
    [239, 'Não-Provimento'], [237, 'Provimento'], [466, 'Homologação de Transação'],
    [12185, 'Decisão Interlocutória de Mérito'], [785, 'Antecipação de tutela'],
    [200, 'Não-Acolhimento de Embargos de Declaração'], [454, 'Indeferimento da petição inicial']]) {
    assert.equal(ehAtoDecisorio({ codigo, nome }), true, `${codigo} ${nome}`);
  }
});
teste('não confunde andamento com decisão, ainda que o nome sugira', () => {
  for (const [codigo, nome] of [[848, 'Trânsito em julgado'], [898, 'Por decisão judicial'],
    [12750, 'de Instrução e Julgamento'], [272, 'A depender do julgamento de outra causa'],
    [11385, 'Execução/Cumprimento de Sentença Iniciada (o)'], [4038, 'Expedição de documento'],
    [85, 'Petição'], [51, 'Conclusão'], [26, 'Distribuição'], [1051, 'Decurso de Prazo']]) {
    assert.equal(ehAtoDecisorio({ codigo, nome }), false, `${codigo} ${nome}`);
  }
});
teste('sem código conhecido, o nome decide', () => {
  for (const n of ['Sentença', 'Despacho', 'Acórdão', 'Decisões diversas']) {
    assert.equal(ehAtoDecisorio({ nome: n }), true, n);
  }
  for (const n of ['Juntada', 'Distribuição', 'Remessa']) {
    assert.equal(ehAtoDecisorio({ nome: n }), false, n);
  }
});

const MOVS = [
  { data: '2026-03-10', titulo: 'Sentença' },
  { data: '2026-04-01', titulo: 'Juntada' },
  { data: '2026-05-05', titulo: 'Despacho' },
  { data: '2026-06-01', titulo: 'Decisão' },
];
const COMS = [
  { data_disponibilizacao: '2026-03-12', texto: 'Julgo procedente o pedido.', link: 'https://x/1' },
  { data_disponibilizacao: '2026-03-18', texto: 'Republicação da sentença.' },
  { data_disponibilizacao: '2026-05-07', texto: 'Manifeste-se em 15 dias.' },
  { data_disponibilizacao: '2026-04-02', texto: 'Intimação de juntada.' },
];
const acoplado = acoplarTeor(MOVS, COMS);
const porTitulo = Object.fromEntries(acoplado.movimentos.map((m) => [m.titulo, m]));

teste('o ato decisório recebe o texto da intimação que o publicou', () => {
  assert.equal(porTitulo['Sentença'].teor, 'Julgo procedente o pedido.');
  assert.equal(porTitulo['Sentença'].linkTeor, 'https://x/1');
  assert.match(porTitulo['Sentença'].fonteTeor, /12\/03\/2026/);
  assert.equal(porTitulo['Despacho'].teor, 'Manifeste-se em 15 dias.');
  assert.equal(acoplado.acoplados, 2);
});
teste('prevalece a publicação mais próxima do ato', () => {
  assert.notEqual(porTitulo['Sentença'].teor, 'Republicação da sentença.');
});
teste('andamento comum não recebe teor, ainda que haja publicação na data', () => {
  assert.equal(porTitulo['Juntada'].teor, undefined);
});
teste('ato sem publicação no intervalo fica sem teor, e não pega o de outro', () => {
  assert.equal(porTitulo['Decisão'].teor, undefined);
});
teste('publicação anterior ao ato nunca é usada', () => {
  const r = acoplarTeor([{ data: '2026-06-10', titulo: 'Sentença' }],
    [{ data_disponibilizacao: '2026-06-01', texto: 'Anterior ao ato.' }]);
  assert.equal(r.acoplados, 0);
});
teste('aceita data de publicação no formato brasileiro', () => {
  const r = acoplarTeor([{ data: '2026-07-01', titulo: 'Decisão' }],
    [{ data_disponibilizacao: '03/07/2026', texto: 'Defiro.' }]);
  assert.equal(r.movimentos[0].teor, 'Defiro.');
});
teste('o teor alimenta a descrição objetiva enviada ao cliente', () => {
  const alvoProcesso = db.inserir('processos', {
    numeroCNJ: cnjValido(801), clienteId: processo.clienteId, status: 'ativo',
  });
  db.inserir('movimentacoes', { processoId: alvoProcesso.id, data: hoje(),
    titulo: 'Sentença', teor: 'Julgo procedente o pedido e condeno a ré.',
    origem: 'andamento processual' });
  const v = novidadesDoProcesso(alvoProcesso.id, { desde: addDays(hoje(), -5) });
  assert.equal(v.itens.length, 1);
  assert.equal(v.itens[0].confiavel, true);
  assert.match(v.itens[0].resumo, /julgado procedente/);
});

console.log('\nCabeçalho das fichas');

const { cabecalhoPagina } = await import('../src/ui/componentes.js');

teste('a ficha oferece o caminho de volta para a listagem', () => {
  const html = cabecalhoPagina('Processo', '', '', { voltar: 'processos' });
  assert.match(html, /class="btn btn--fantasma voltar"/);
  assert.match(html, /href="#\/processos"/);
  assert.match(html, /aria-label="Voltar"/);
});
teste('listagem não exibe retorno, por não haver de onde voltar', () => {
  assert.ok(!cabecalhoPagina('Processos').includes('voltar'));
});

console.log('\nDiagnóstico do teor');

const { atualizarPeloTribunal: atualizar2 } = await import('../src/core/integracoes.js');
const fetchTeor = globalThis.fetch;

const processoTeor = db.inserir('processos', {
  numeroCNJ: cnjValido(901), clienteId: processo.clienteId, status: 'ativo', tribunal: 'TJPE',
});

const respostaComSentenca = {
  ok: true, status: 200,
  json: async () => ({ hits: { hits: [{ _source: {
    numeroProcesso: cnjValido(901), tribunal: 'TJPE',
    dataHoraUltimaAtualizacao: '2026-09-10T10:00:00.000Z',
    movimentos: [{ codigo: 193, nome: 'Sentença', dataHora: '2026-05-20T16:00:00.000Z' }],
  } }] } }),
  text: async () => '{}',
};

// Diário sem publicação alguma do processo.
globalThis.fetch = async (url) => (String(url).includes('datajud') || String(url).includes('_search')
  ? respostaComSentenca
  : { ok: true, status: 200, json: async () => ({ count: 0, items: [] }), text: async () => '{}' });
const semPublicacao = await atualizar2(processoTeor.id);

// Publicação existente, porém fora do intervalo entre o ato e a publicação.
db.listar('movimentacoes', { processoId: processoTeor.id })
  .forEach((m) => db.removerDefinitivo('movimentacoes', m.id));
globalThis.fetch = async (url) => (String(url).includes('datajud') || String(url).includes('_search')
  ? respostaComSentenca
  : { ok: true, status: 200, text: async () => '{}',
    json: async () => ({ count: 1, items: [{ numero_processo: cnjValido(901),
      data_disponibilizacao: '2026-09-30', texto: 'Publicação muito posterior ao ato.' }] }) });
const foraDoIntervalo = await atualizar2(processoTeor.id);

// Diário indisponível.
db.listar('movimentacoes', { processoId: processoTeor.id })
  .forEach((m) => db.removerDefinitivo('movimentacoes', m.id));
globalThis.fetch = async (url) => {
  if (String(url).includes('datajud') || String(url).includes('_search')) return respostaComSentenca;
  throw new TypeError('Failed to fetch');
};
const diarioMudo = await atualizar2(processoTeor.id);
globalThis.fetch = fetchTeor;

teste('sem publicação do processo, o motivo é dito por extenso', () => {
  assert.equal(semPublicacao.ok, true);
  assert.equal(semPublicacao.decisorios, 1);
  assert.equal(semPublicacao.comTeor, 0);
  assert.match(semPublicacao.motivoTeor, /não tem publicação alguma|segredo de justiça/i);
});
teste('publicação fora do intervalo é relatada como tal', () => {
  assert.equal(foraDoIntervalo.comTeor, 0);
  assert.match(foraDoIntervalo.motivoTeor, /intervalo esperado/i);
  assert.match(foraDoIntervalo.motivoTeor, /à mão/i);
});
teste('falha de comunicação com o diário não é confundida com ausência de teor', () => {
  assert.equal(diarioMudo.comTeor, 0);
  assert.match(diarioMudo.motivoTeor, /diário não respondeu/i);
});
teste('a importação dos movimentos ocorre ainda que o teor falhe', () => {
  assert.equal(diarioMudo.importados, 1);
});

console.log('\nRelato quando não há ato decisório');

const fetchSemDecisao = globalThis.fetch;
const processoSemDecisao = db.inserir('processos', {
  numeroCNJ: cnjValido(902), clienteId: processo.clienteId, status: 'ativo', tribunal: 'TJPE',
});
globalThis.fetch = async () => ({
  ok: true, status: 200, text: async () => '{}',
  json: async () => ({ hits: { hits: [{ _source: {
    numeroProcesso: cnjValido(902), tribunal: 'TJPE',
    dataHoraUltimaAtualizacao: '2026-09-10T10:00:00.000Z',
    movimentos: [
      { codigo: 26, nome: 'Distribuição', dataHora: '2026-01-15T09:00:00.000Z' },
      { codigo: 85, nome: 'Petição', dataHora: '2026-02-01T09:00:00.000Z' },
    ],
  } }] } }),
});
const soAndamento = await atualizar2(processoSemDecisao.id);
globalThis.fetch = fetchSemDecisao;

teste('processo só com andamento explica a ausência de teor', () => {
  assert.equal(soAndamento.importados, 2);
  assert.equal(soAndamento.decisorios, 0);
  assert.match(soAndamento.motivoTeor, /ato decisório/i);
});

console.log(`\n${passou} verificações concluídas.`);
