# Arquitetura

## Camadas

```
views/  →  ui/  →  core/
```

- **core** concentra as regras. Não conhece DOM, não importa nada de `ui/` ou `views/`.
  É a camada testada por `testes/testes.mjs` e a que sobrevive a qualquer troca de
  interface.
- **ui** oferece primitivas (elementos, modais, avisos, formulários, roteador) e
  componentes compartilhados (calendário, listas, cabeçalhos).
- **views** monta uma tela por módulo. Nenhuma view consulta o armazenamento
  diretamente para leituras compostas: tudo passa por `core/dominio.js`.

## Fluxo principal

```
publicação → identificação do processo pelo número CNJ → leitura assistida
    → sugestão de prazo → conferência do advogado → confirmação
    → prazo na agenda → alertas → execução → conclusão → histórico do processo
```

A etapa de conferência é obrigatória por desenho. `interpretarPublicacao` devolve
sempre `exigeConfirmacao: true`, e a criação do prazo ocorre apenas na tela de
conferência, em `views/publicacoes.js`.

## Modelo de dados

Coleções em `core/store.js`:

| Coleção | Conteúdo |
| --- | --- |
| `usuarios` | nome, e-mail, perfil, permissões individuais, hash e sal da senha |
| `clientes` | pessoa física ou jurídica, documento, contatos, endereço, classificação |
| `processos` | número CNJ (único), tribunal, comarca, UF, vara, classe, assunto, polos, cliente, responsável, valor da causa, fase, status |
| `prazos` | processo, cliente, tipo, datas, prioridade, prazo fatal, responsável, régua de alertas, `regraCalculo`, `origemPublicacaoId` |
| `tarefas` | providências internas com responsável, prazo e prioridade |
| `audiencias` | data, hora, modalidade, endereço, link, responsável |
| `publicacoes` | número CNJ, datas, diário, conteúdo, `sugestao`, status da conferência |
| `documentos` | categoria, pasta, vínculos, arquivo |
| `comunicacoes` | canal, destinatário, mensagem, status, vínculos |
| `financeiro` | honorários contratados e parcelas |
| `feriados` / `suspensoes` | calendário forense configurável |
| `auditoria` | quem, quando, o quê, antes e depois |
| `notificacoes` | central de alertas, com chave idempotente |

Todo registro carrega `criadoEm`, `criadoPor`, `atualizadoEm` e, quando excluído,
`excluidoEm`, `excluidoPor` e `motivoExclusao`. A listagem padrão ignora excluídos.

### Vínculos

`CLIENTE → PROCESSO → PUBLICAÇÃO → PRAZO → TAREFA → ADVOGADO → DOCUMENTO →
COMUNICAÇÃO → RELATÓRIO`

Cada tela oferece o caminho de volta: do prazo para o processo, do processo para a
publicação que o originou, do cliente para todos os processos, da publicação para o
prazo confirmado.

## Persistência e sincronização

`core/store.js` expõe uma interface única — `db.listar`, `db.obter`, `db.inserir`,
`db.atualizar`, `db.remover`, `db.restaurar`, `db.removerDefinitivo`, `db.config`,
`db.salvarConfig` — e opera em dois modos, decididos na abertura do sistema pela
resposta de `/api/saude`:

**Modo servidor.** O backend em `servidor/` é a fonte dos dados. A interface carrega
o estado completo ao entrar, responde às leituras a partir de uma cópia em memória e
transforma cada gravação em mutação enviada ao servidor. A fila fica no navegador
enquanto não é aceita, sobrevive à queda de conexão e é reenviada automaticamente. A
cada 30 segundos, ao voltar o foco da aba e ao retornar a rede, a interface pede
apenas o que mudou desde a última conversa.

**Modo local.** Sem backend, tudo fica no armazenamento do navegador. Serve para
demonstração e para contingência.

Duas coleções nunca sobem para o servidor: `auditoria`, que é gerada por ele e vem
pronta, e `notificacoes`, que são o alerta pessoal de cada usuário no dispositivo dele.

O que o servidor não delega ao navegador:

- conferência de senha e emissão da sessão;
- autorização de cada gravação, por perfil e permissão individual;
- unicidade do número CNJ e demais validações de integridade;
- campos de controle (`criadoPor`, `atualizadoEm`, `excluidoEm`);
- registro de auditoria com autoria confiável.

A permissão é avaliada nos dois lados a partir do mesmo arquivo,
`core/perfis.js`: no navegador para decidir o que exibir, no servidor para decidir
o que autorizar.

Limite conhecido: a resolução de conflito é por registro, com prevalência da última
gravação. Duas pessoas editando o mesmo prazo ao mesmo tempo terminam com o valor de
quem gravou por último, e ambas as gravações permanecem na auditoria.

## Pontos de extensão

`core/integracoes.js` isola tudo o que depende de terceiros. Cada adaptador tem um
trecho marcado como ponto de extensão:

- `publicacoes.consultar` — requisição ao provedor de monitoramento. A rotina padrão
  roda às segundas, quartas e sextas e é verificada a cada abertura do sistema.
- `whatsapp.enviar` — chamada à API oficial. Sem credencial, abre o WhatsApp Web.
- `email.enviar` — envio por servidor. Sem servidor, abre o cliente de e-mail.
- `gerarICS` — exportação para Google, Apple e Outlook Calendar.
- `core/ia.js` — `interpretarPublicacao` pode delegar a um modelo de linguagem
  mantendo o mesmo formato de retorno.

Integrações com tribunais (PJe, e-SAJ, eproc, Projudi), assinatura eletrônica e
armazenamento em nuvem entram como novos adaptadores nesse mesmo arquivo, sem tocar
nas telas.

## Segurança e proteção de dados

- Senhas guardadas apenas como SHA-256 com sal individual.
- Perfis (administrador, advogado, assistente, financeiro) e permissões individuais no
  formato `modulo:acao`, com curinga por módulo.
- Auditoria de criação, alteração, exclusão e restauração, com identificação do usuário.
- Exclusão lógica com lixeira e restauração; exclusão definitiva sob confirmação
  explícita.
- Backup manual e cópia diária automática.
- Enquanto não houver servidor, os dados permanecem restritos ao dispositivo. A
  adequação plena à LGPD (registro de tratamento, prazo de retenção, resposta a
  titulares) depende da etapa de backend.
