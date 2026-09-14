// Perfis e permissões.
//
// Arquivo compartilhado entre a interface e o servidor: o navegador usa para
// decidir o que exibir, o servidor usa para decidir o que autorizar. A regra
// vale nos dois lados a partir da mesma fonte.

export const PERFIS = {
  admin: {
    rotulo: 'Administrador',
    descricao: 'Acesso integral, incluindo usuários, permissões e configurações.',
    permissoes: ['*'],
  },
  advogado: {
    rotulo: 'Advogado',
    descricao: 'Processos, prazos, clientes, audiências, publicações e relatórios.',
    permissoes: [
      'dashboard:ver', 'agenda:ver', 'prazos:*', 'processos:*', 'clientes:*', 'tarefas:*',
      'audiencias:*', 'publicacoes:*', 'documentos:*', 'relatorios:ver', 'comunicacoes:*',
      'ia:usar', 'configuracoes:ver', 'notificacoes:*',
    ],
  },
  assistente: {
    rotulo: 'Assistente',
    descricao: 'Tarefas, documentos, agenda e apoio ao cadastro, sem exclusões.',
    permissoes: [
      'dashboard:ver', 'agenda:ver', 'prazos:ver', 'prazos:criar', 'prazos:editar',
      'processos:ver', 'processos:criar', 'processos:editar', 'clientes:ver', 'clientes:criar',
      'tarefas:*', 'audiencias:ver', 'audiencias:criar', 'audiencias:editar',
      'publicacoes:ver', 'publicacoes:editar', 'documentos:*', 'comunicacoes:ver',
      'ia:usar', 'notificacoes:*',
    ],
  },
  financeiro: {
    rotulo: 'Financeiro',
    descricao: 'Módulo financeiro, clientes e relatórios econômicos.',
    permissoes: ['dashboard:ver', 'financeiro:*', 'clientes:ver', 'relatorios:ver', 'notificacoes:*'],
  },
};

/** Verifica permissão no formato "modulo:acao". */
export function temPermissao(usuario, acao) {
  if (!usuario) return false;
  const lista = usuario.permissoes?.length ? usuario.permissoes : PERFIS[usuario.perfil]?.permissoes || [];
  if (lista.includes('*')) return true;
  const [modulo] = acao.split(':');
  return lista.includes(acao) || lista.includes(`${modulo}:*`);
}

/** Módulo responsável por cada coleção, para autorizar gravações. */
export const MODULO_DA_COLECAO = {
  usuarios: 'usuarios',
  clientes: 'clientes',
  processos: 'processos',
  prazos: 'prazos',
  tarefas: 'tarefas',
  audiencias: 'audiencias',
  publicacoes: 'publicacoes',
  documentos: 'documentos',
  comunicacoes: 'comunicacoes',
  financeiro: 'financeiro',
  movimentacoes: 'processos',
  notificacoes: 'notificacoes',
  feriados: 'configuracoes',
  suspensoes: 'configuracoes',
};

export const ACAO_DA_OPERACAO = {
  inserir: 'criar', atualizar: 'editar', remover: 'excluir',
  restaurar: 'excluir', removerDefinitivo: 'excluir',
};
