# Sentinela — Gestão Jurídica

Sistema de gestão de escritório de advocacia orientado a um único objetivo central:
**impedir que um prazo importante passe despercebido.**

Aplicação web em JavaScript puro (módulos ES), sem dependências de terceiros e sem
etapa de build. Roda em qualquer navegador moderno, no computador e no celular.

## Como executar

### Com backend, para uso real

```bash
cd servidor
npm start
# abra http://localhost:3000
```

Os dados passam a ficar no servidor, compartilhados por toda a equipe, com
usuários, permissões e auditoria de verdade. No primeiro início o terminal
mostra o acesso do administrador. Instruções completas, incluindo publicação
com HTTPS e backup, em [`servidor/README.md`](../servidor/README.md).

### Sem backend, para conhecer o sistema

```bash
# a partir da raiz do repositório
npx http-server -p 8080 .
# abra http://localhost:8080/sentinela/
```

Nesse modo tudo fica no armazenamento do próprio navegador, com base de
demonstração criada automaticamente:

| E-mail | Senha | Perfil |
| --- | --- | --- |
| admin@escritorio.adv.br | sentinela | Administrador |
| maria@escritorio.adv.br | sentinela | Advogado |
| carlos@escritorio.adv.br | sentinela | Assistente |

A aplicação escolhe o modo sozinha: se houver servidor na origem em que ela foi
aberta, ele é a fonte dos dados; se não houver, ela funciona localmente. Abrir o
arquivo direto pelo sistema de arquivos (`file://`) não funciona, porque módulos
ES exigem origem HTTP.

## Testes

```bash
node sentinela/testes/testes.mjs                      # 37 verificações do núcleo
node servidor/testes/testes.mjs                       # 28 verificações da API
```

O primeiro cobre validação do número CNJ, calendário forense, contagem de prazos,
leitura de publicações, prevenção de conflitos, auditoria e relatório do cliente.
O segundo cobre autenticação, permissões por perfil, validações de gravação,
auditoria e sincronização.

## O que já funciona

- **Dashboard** com calendário mensal de segunda a domingo, navegação por mês e ano,
  visões dia/semana/mês/lista, indicadores do dia, dos próximos sete dias, de prazos
  vencidos, publicações pendentes, processos ativos e clientes.
- **Painel "O que preciso fazer hoje?"** reunindo vencidos, prazos do dia, próximos
  três dias, publicações a conferir, audiências, tarefas e clientes sem contato recente.
- **Prazos** com criação, edição, conclusão, reabertura, duplicação, exclusão lógica,
  prioridade, prazo fatal, responsável, régua de alertas por prazo e registro da regra
  de contagem utilizada.
- **Motor de contagem** com dias úteis e corridos, feriados nacionais fixos e móveis,
  feriados estaduais, municipais e de tribunal, suspensões de expediente, recesso do
  art. 220 do CPC, prazo em dobro e memória de cálculo completa.
- **Processos** com o número CNJ como identificador único, validação do dígito
  verificador, bloqueio de duplicidade, ficha completa e linha do tempo cronológica.
- **Publicações** com importação manual, associação automática ao processo pelo número
  CNJ, leitura assistida, sugestão de prazo e fila de conferência. Nenhum prazo entra
  na agenda sem confirmação do advogado.
- **Clientes** com panorama consolidado e relatório em linguagem acessível, com envio
  por WhatsApp, e-mail, download ou impressão em PDF.
- **Tarefas, audiências, documentos, financeiro, comunicações, relatórios gerenciais,
  busca global, controle de usuários, auditoria, lixeira e backup.**
- **Interface responsiva** com navegação inferior no celular e tema claro/escuro.
- **Uso por equipe** quando o backend está no ar: cada pessoa com seu acesso, dados
  compartilhados, permissões aplicadas no servidor e auditoria com autoria confiável.

## O que depende de contratação externa

Estes módulos estão implementados como adaptadores, com a interface pronta e o ponto
de extensão isolado em um único arquivo (`src/core/integracoes.js`):

| Integração | Estado atual | O que falta |
| --- | --- | --- |
| Captura de publicações | Importação manual e fila de conferência funcionando | Credencial de um provedor de monitoramento de diários |
| WhatsApp | Abre o WhatsApp Web e registra o histórico | Conta e token da API oficial do WhatsApp Business |
| E-mail | Abre o cliente de e-mail e registra o envio | Servidor SMTP ou API de envio |
| Leitura por IA | Análise heurística local, sem rede | Endpoint e chave de um modelo de linguagem |
| Calendário externo | Exportação `.ics` unidirecional | OAuth do Google/Microsoft para sincronismo |

A agenda do sistema é sempre a fonte principal dos prazos. A exportação para
calendários externos é unidirecional, para que alteração feita fora não apague nem
modifique prazo jurídico.

## Estrutura

```
sentinela/
├── index.html
├── assets/css/app.css          design system, responsivo, tema claro/escuro
├── src/
│   ├── app.js                  inicialização, rotas e rotina diária
│   ├── core/                   regras — não dependem de interface
│   │   ├── util.js             datas, formatação, validação do CNJ
│   │   ├── feriados.js         calendário forense
│   │   ├── calculo-prazo.js    motor de contagem com memória de cálculo
│   │   ├── store.js            persistência local ou sincronizada, com fila de envio
│   │   ├── api.js              cliente da API do servidor
│   │   ├── perfis.js           perfis e permissões, compartilhados com o servidor
│   │   ├── dominio.js          consultas compostas e prevenção de conflitos
│   │   ├── auth.js             usuários, perfis e permissões
│   │   ├── ia.js               leitura de publicações e relatório do cliente
│   │   ├── integracoes.js      WhatsApp, e-mail, iCalendar, publicações
│   │   └── seed.js             base de demonstração
│   ├── ui/                     primitivas de interface e componentes
│   └── views/                  uma tela por módulo
├── testes/testes.mjs
└── docs/
```

O backend fica em [`servidor/`](../servidor), na raiz do repositório.

## Persistência

Com backend, os dados ficam em SQLite no servidor. A interface mantém uma cópia de
trabalho em memória para responder de imediato, envia cada gravação como mutação e
guarda em fila o que não conseguir enviar, reenviando quando a conexão volta. A cada
30 segundos busca o que mudou, de modo que o trabalho de um usuário aparece para os
demais.

Sem backend, tudo fica no `localStorage`, com cópia diária automática e
exportação de backup em Configurações.

Nos dois casos a aplicação conversa apenas com a interface `db` de
`src/core/store.js`. Consulte `docs/ARQUITETURA.md`.

## Princípios de projeto

1. O advogado não procura o que precisa fazer — o sistema mostra.
2. A IA sugere, o advogado decide. Nenhum prazo é lançado sem confirmação.
3. A regra de contagem nunca é presumida em silêncio: fica registrada junto ao prazo.
4. O sistema alerta antes de gravar informação conflitante e nunca sobrescreve dado
   jurídico sem confirmação.
5. Exclusão é lógica e recuperável; a exclusão definitiva exige confirmação explícita.
