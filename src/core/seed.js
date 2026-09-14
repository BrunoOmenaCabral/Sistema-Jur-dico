// Base de demonstração. Executa uma única vez, quando não há usuários
// cadastrados, e produz datas relativas ao dia corrente para que o dashboard
// já apresente prazos vencidos, do dia e futuros.

import { db } from './store.js';
import { criarUsuario } from './auth.js';
import { hoje, addDays, uid } from './util.js';
import { calcularPrazo } from './calculo-prazo.js';

/** Monta um número CNJ válido calculando o dígito verificador. */
function numeroCNJ(sequencial, ano, segmento, tribunal, origem) {
  const nnnnnnn = String(sequencial).padStart(7, '0');
  const base = `${nnnnnnn}${ano}${segmento}${String(tribunal).padStart(2, '0')}${String(origem).padStart(4, '0')}00`;
  let resto = 0;
  for (const ch of base) resto = (resto * 10 + Number(ch)) % 97;
  const dv = String(98 - resto).padStart(2, '0');
  return `${nnnnnnn}${dv}${ano}${segmento}${String(tribunal).padStart(2, '0')}${String(origem).padStart(4, '0')}`;
}

/**
 * @param {object} opcoes
 *  - forcar: semeia mesmo havendo usuários (usado para carregar a demonstração
 *    sobre uma base de servidor já criada);
 *  - criarUsuarios: no modo servidor os acessos são criados pelo administrador,
 *    então a demonstração apenas reaproveita os usuários existentes.
 */
export async function semear({ forcar = false, criarUsuarios = true } = {}) {
  const existentes = db.listar('usuarios');
  if (!forcar && existentes.length) return false;

  let admin, advogada, assistente;
  if (criarUsuarios) {
    admin = await criarUsuario({
      nome: 'Bruno Omena Cabral', email: 'admin@escritorio.adv.br', senha: 'sentinela',
      perfil: 'admin', oab: 'OAB/PE 00000',
    });
    advogada = await criarUsuario({
      nome: 'Maria Andrade', email: 'maria@escritorio.adv.br', senha: 'sentinela',
      perfil: 'advogado', oab: 'OAB/PE 11111',
    });
    assistente = await criarUsuario({
      nome: 'Carlos Lima', email: 'carlos@escritorio.adv.br', senha: 'sentinela',
      perfil: 'assistente',
    });
  } else {
    [admin, advogada = admin, assistente = admin] = existentes;
    if (!admin) throw new Error('Cadastre ao menos um usuário antes de carregar a demonstração.');
  }

  const clientes = [
    { nome: 'João Pereira da Silva', tipoPessoa: 'PF', documento: '12345678909',
      email: 'joao.pereira@email.com', telefone: '81988887777', whatsapp: '81988887777',
      cidade: 'Recife', uf: 'PE', tipoCliente: 'Ativo', ativo: true },
    { nome: 'Construtora Horizonte Ltda.', tipoPessoa: 'PJ', documento: '12345678000195',
      email: 'juridico@horizonte.com.br', telefone: '8133334444', whatsapp: '81999995555',
      cidade: 'Recife', uf: 'PE', tipoCliente: 'Contrato mensal', ativo: true },
    { nome: 'Ana Beatriz Nunes', tipoPessoa: 'PF', documento: '98765432100',
      email: 'ana.nunes@email.com', telefone: '81977776666', whatsapp: '81977776666',
      cidade: 'Olinda', uf: 'PE', tipoCliente: 'Ativo', ativo: true },
  ].map((c) => db.inserir('clientes', c, 'Cliente de demonstração'));

  const processos = [
    { numeroCNJ: numeroCNJ(801701, 2026, 8, 17, 1), tribunal: 'TJPE', comarca: 'Recife',
      uf: 'PE', vara: '12ª Vara Cível da Capital', classe: 'Procedimento Comum Cível',
      assunto: 'Indenização por danos morais', poloAtivo: 'João Pereira da Silva',
      poloPassivo: 'Telecom Nordeste S/A', clienteId: clientes[0].id, responsavelId: admin.id,
      advogadoAdverso: 'Dr. Ricardo Sales (OAB/PE 22222)', valorCausa: 35000,
      fase: 'Conhecimento', status: 'ativo', dataDistribuicao: addDays(hoje(), -120),
      regimePrazo: 'uteis' },
    { numeroCNJ: numeroCNJ(500322, 2026, 8, 17, 1), tribunal: 'TJPE', comarca: 'Recife',
      uf: 'PE', vara: '3ª Vara da Fazenda Pública', classe: 'Execução Fiscal',
      assunto: 'ISS — cobrança', poloAtivo: 'Município do Recife',
      poloPassivo: 'Construtora Horizonte Ltda.', clienteId: clientes[1].id,
      responsavelId: advogada.id, valorCausa: 180000, fase: 'Execução', status: 'ativo',
      dataDistribuicao: addDays(hoje(), -400), regimePrazo: 'uteis' },
    { numeroCNJ: numeroCNJ(100845, 2026, 5, 6, 51), tribunal: 'TRT6', comarca: 'Recife',
      uf: 'PE', vara: '5ª Vara do Trabalho do Recife', classe: 'Reclamação Trabalhista',
      assunto: 'Verbas rescisórias', poloAtivo: 'Ana Beatriz Nunes',
      poloPassivo: 'Comércio Atlântico Ltda.', clienteId: clientes[2].id,
      responsavelId: advogada.id, valorCausa: 42000, fase: 'Instrução', status: 'ativo',
      dataDistribuicao: addDays(hoje(), -60), regimePrazo: 'uteis' },
    { numeroCNJ: numeroCNJ(200110, 2025, 8, 17, 1), tribunal: 'TJPE', comarca: 'Olinda',
      uf: 'PE', vara: '2ª Vara Cível de Olinda', classe: 'Procedimento Comum Cível',
      assunto: 'Revisão contratual', poloAtivo: 'Ana Beatriz Nunes',
      poloPassivo: 'Banco Meridional S/A', clienteId: clientes[2].id, responsavelId: admin.id,
      valorCausa: 22000, fase: 'Arquivado', status: 'encerrado',
      dataDistribuicao: addDays(hoje(), -700), regimePrazo: 'uteis' },
  ].map((p) => db.inserir('processos', p, 'Processo de demonstração'));

  const prazo = (dados) => db.inserir('prazos', {
    status: 'pendente', prioridade: 'normal', alertas: [7, 5, 3, 1, 0], ...dados,
  }, 'Prazo de demonstração');

  prazo({ processoId: processos[0].id, clienteId: clientes[0].id, tipo: 'manifestacao',
    descricao: 'Manifestação sobre documentos juntados', dataInicio: addDays(hoje(), -12),
    dataVencimento: addDays(hoje(), -2), prioridade: 'urgente', responsavelId: admin.id,
    regraCalculo: { resumoRegra: '15 dias úteis · art. 224 do CPC' } });

  prazo({ processoId: processos[1].id, clienteId: clientes[1].id, tipo: 'embargos',
    descricao: 'Embargos à execução fiscal', dataInicio: addDays(hoje(), -8),
    dataVencimento: hoje(), prioridade: 'fatal', fatal: true, responsavelId: advogada.id,
    regraCalculo: { resumoRegra: '30 dias · Lei 6.830/80' } });

  prazo({ processoId: processos[2].id, clienteId: clientes[2].id, tipo: 'recurso',
    descricao: 'Recurso ordinário', dataInicio: hoje(), dataVencimento: addDays(hoje(), 3),
    prioridade: 'importante', responsavelId: advogada.id });

  prazo({ processoId: processos[0].id, clienteId: clientes[0].id, tipo: 'replica',
    descricao: 'Réplica à contestação', dataInicio: hoje(), dataVencimento: addDays(hoje(), 9),
    responsavelId: admin.id });

  prazo({ processoId: processos[1].id, clienteId: clientes[1].id, tipo: 'contestacao',
    descricao: 'Contestação em ação conexa', dataInicio: addDays(hoje(), -20),
    dataVencimento: addDays(hoje(), -10), status: 'concluido',
    concluidoEm: new Date(Date.now() - 9 * 864e5).toISOString(), responsavelId: advogada.id });

  db.inserir('audiencias', { processoId: processos[2].id, clienteId: clientes[2].id,
    data: addDays(hoje(), 5), hora: '14:30', modalidade: 'Virtual',
    link: 'https://pje.trt6.jus.br/audiencia/sala', responsavelId: advogada.id,
    status: 'pendente', observacoes: 'Audiência de instrução. Testemunhas confirmadas.' },
  'Audiência de demonstração');

  db.inserir('audiencias', { processoId: processos[0].id, clienteId: clientes[0].id,
    data: addDays(hoje(), 21), hora: '09:00', modalidade: 'Presencial',
    endereco: 'Fórum Rodolfo Aureliano — Recife/PE', responsavelId: admin.id, status: 'pendente' },
  'Audiência de demonstração');

  const tarefas = [
    { titulo: 'Solicitar documentos ao cliente', processoId: processos[0].id,
      clienteId: clientes[0].id, responsavelId: assistente.id, dataVencimento: hoje(),
      prioridade: 'importante', status: 'pendente' },
    { titulo: 'Preparar procuração e contrato de honorários', processoId: processos[2].id,
      clienteId: clientes[2].id, responsavelId: assistente.id, dataVencimento: addDays(hoje(), 2),
      prioridade: 'normal', status: 'pendente' },
    { titulo: 'Conferir cálculo da execução', processoId: processos[1].id,
      clienteId: clientes[1].id, responsavelId: advogada.id, dataVencimento: addDays(hoje(), 4),
      prioridade: 'importante', status: 'andamento' },
    { titulo: 'Protocolar petição de juntada', processoId: processos[0].id,
      clienteId: clientes[0].id, responsavelId: admin.id, dataVencimento: addDays(hoje(), -1),
      prioridade: 'urgente', status: 'pendente' },
  ];
  tarefas.forEach((t) => db.inserir('tarefas', t, 'Tarefa de demonstração'));

  db.inserir('documentos', { processoId: processos[0].id, clienteId: clientes[0].id,
    categoria: 'Procuração', nome: 'procuracao-joao-pereira.pdf', pasta: 'Documentos do cliente',
    tamanho: 184320, tipo: 'application/pdf' }, 'Documento de demonstração');
  db.inserir('documentos', { processoId: processos[1].id, clienteId: clientes[1].id,
    categoria: 'Contrato', nome: 'contrato-honorarios-horizonte.pdf', pasta: 'Contratos',
    tamanho: 262144, tipo: 'application/pdf' }, 'Documento de demonstração');

  db.inserir('movimentacoes', { processoId: processos[0].id, data: addDays(hoje(), -15),
    titulo: 'Decisão publicada', descricao: 'Deferida a produção de prova documental.' },
  'Movimentação de demonstração');

  // Publicação aguardando conferência — alimenta a fila da tela de publicações.
  const pub = {
    numeroCNJ: processos[0].numeroCNJ,
    dataDisponibilizacao: addDays(hoje(), -1),
    dataPublicacao: hoje(),
    diario: 'DJe TJPE',
    conteudo: `Processo nº ${processos[0].numeroCNJ}. Intime-se a parte autora para, `
      + 'querendo, manifestar-se sobre a contestação e os documentos juntados, no prazo de 15 (quinze) dias.',
  };
  const { interpretarPublicacao } = await import('./ia.js');
  const sugestao1 = interpretarPublicacao(pub);
  db.inserir('publicacoes', { ...pub, status: 'pendente', processoId: sugestao1.processoId, sugestao: sugestao1 },
    'Publicação de demonstração');

  const pub2 = {
    numeroCNJ: processos[2].numeroCNJ,
    dataPublicacao: addDays(hoje(), -1),
    diario: 'DEJT TRT6',
    conteudo: `Processo nº ${processos[2].numeroCNJ}. Fica a parte reclamante intimada da `
      + 'designação de audiência de instrução, bem como para apresentar rol de testemunhas '
      + 'no prazo de 5 (cinco) dias úteis.',
  };
  const sugestao2 = interpretarPublicacao(pub2);
  db.inserir('publicacoes', { ...pub2, status: 'pendente', processoId: sugestao2.processoId, sugestao: sugestao2 },
    'Publicação de demonstração');

  db.inserir('financeiro', { clienteId: clientes[1].id, processoId: processos[1].id,
    descricao: 'Honorários — execução fiscal', valorContratado: 18000,
    parcelas: [
      { n: 1, valor: 6000, vencimento: addDays(hoje(), -30), pagoEm: addDays(hoje(), -28) },
      { n: 2, valor: 6000, vencimento: addDays(hoje(), 1), pagoEm: null },
      { n: 3, valor: 6000, vencimento: addDays(hoje(), 31), pagoEm: null },
    ] }, 'Contrato de honorários de demonstração');

  db.inserir('feriados', { data: `${hoje().slice(0, 4)}-06-24`, nome: 'São João',
    abrangencia: 'estadual', uf: 'PE' }, 'Feriado estadual');
  db.inserir('feriados', { data: `${hoje().slice(0, 4)}-12-08`, nome: 'Nossa Senhora da Conceição',
    abrangencia: 'municipal', uf: 'PE', municipio: 'Recife' }, 'Feriado municipal');

  return true;
}
