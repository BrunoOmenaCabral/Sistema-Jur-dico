// Configurações padrão do escritório, espelhando as do navegador.
export function configuracoesPadrao() {
  return {
    escritorio: { nome: 'Escritório de Advocacia', oab: '', email: '', telefone: '', whatsapp: '' },
    alertasPadrao: [7, 5, 3, 1, 0],
    recessoForense: true,
    cores: {
      fatal: '#e5484d', urgente: '#e5484d', proximo: '#f76b15', tarefa: '#f5d90a',
      audiencia: '#3b82f6', concluido: '#30a46c', cancelado: '#6b7280', publicacao: '#8b5cf6',
    },
    automacoesWhatsapp: {
      prazoProximo: { ativo: true, antecedencia: 3 },
      audiencia: { ativo: true, antecedencia: 2 },
      relatorioMensal: { ativo: false, dia: 1 },
    },
    integracoes: {
      publicacoes: { ativo: false, provedor: '', chave: '', dias: ['seg', 'qua', 'sex'], ultimaConsulta: null },
      ia: { ativo: false, provedor: 'heuristico', endpoint: '', chave: '', modelo: '' },
      whatsapp: { ativo: false, provedor: '', numero: '', token: '' },
      email: { ativo: false, remetente: '', servidor: '' },
      calendario: { ativo: false, provedor: '' },
    },
  };
}
