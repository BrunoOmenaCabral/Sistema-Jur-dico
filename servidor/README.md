# Backend do Sentinela

Servidor da aplicação e API, em Node.js sem nenhuma dependência externa.
Guarda os dados em SQLite (banco embutido do próprio Node) e serve a interface
que está em `sentinela/`. Requer Node.js 22 ou superior.

## Executar

```bash
cd servidor
npm start                 # node src/principal.js
# abra http://localhost:3000
```

No primeiro início o servidor cria o usuário administrador e imprime a senha
no terminal. Anote e troque no primeiro acesso, em Usuários.

```
--- Acesso inicial do administrador ---
E-mail: admin@escritorio.adv.br
Senha:  TjEz2Mr58W36gX  (gerada agora — anote e troque no primeiro acesso)
---------------------------------------
```

Para definir a senha inicial em vez de recebê-la gerada:

```bash
SENTINELA_ADMIN_EMAIL=voce@escritorio.adv.br SENTINELA_ADMIN_SENHA='sua-senha-forte' npm start
```

## Testes

```bash
node servidor/testes/testes.mjs
```

São 28 verificações de ponta a ponta: autenticação, bloqueio por tentativas,
permissões por perfil, validações de gravação, auditoria, sincronização
incremental e proteção contra requisição forjada de outro site.

## Variáveis de ambiente

| Variável | Padrão | Função |
| --- | --- | --- |
| `PORTA` | `3000` | Porta de escuta |
| `HOST` | `0.0.0.0` | Interface de escuta. Use `127.0.0.1` atrás de proxy |
| `SENTINELA_DADOS` | `servidor/dados` | Diretório do banco e do segredo de sessão |
| `SENTINELA_ESTATICOS` | `sentinela/` | Diretório da interface |
| `SENTINELA_SEGREDO` | gerado | Chave de assinatura das sessões |
| `SENTINELA_HTTPS` | `false` | Marque `true` atrás de HTTPS: o cookie passa a exigir conexão segura |
| `SENTINELA_SESSAO_HORAS` | `12` | Duração da sessão |
| `SENTINELA_ADMIN_EMAIL` | `admin@escritorio.adv.br` | E-mail do administrador inicial |
| `SENTINELA_ADMIN_SENHA` | gerada | Senha do administrador inicial |
| `SENTINELA_LIMITE_CORPO` | `12 MB` | Tamanho máximo de requisição |

## API

Todas as rotas em `/api`. As gravações exigem sessão válida e o cabeçalho
`X-Requisicao: sentinela`.

| Rota | Método | Função |
| --- | --- | --- |
| `/api/saude` | GET | Verificação de disponibilidade |
| `/api/sessao` | POST | Entrar. Devolve cookie httpOnly assinado |
| `/api/sessao` | GET | Usuário da sessão atual |
| `/api/sessao` | DELETE | Sair |
| `/api/estado` | GET | Estado completo. Com `?desde=<ISO>`, apenas o que mudou |
| `/api/mutacoes` | POST | Lote de gravações, validadas e auditadas uma a uma |
| `/api/configuracoes` | PUT | Configurações do escritório |
| `/api/usuarios` | POST | Criar usuário (administrador) |
| `/api/usuarios/:id/senha` | PUT | Trocar senha (própria, ou qualquer uma se administrador) |

### Formato das mutações

```json
{ "mutacoes": [
  { "op": "inserir", "colecao": "clientes", "dados": { "id": "cli_1", "nome": "João" },
    "detalhe": "Cliente cadastrado" },
  { "op": "atualizar", "colecao": "prazos", "id": "pra_9", "dados": { "status": "concluido" } },
  { "op": "remover", "colecao": "tarefas", "id": "tar_3", "detalhe": "duplicada" }
] }
```

Operações: `inserir`, `atualizar`, `remover` (lógica), `restaurar`,
`removerDefinitivo`. A resposta separa `aplicadas` de `recusadas`, com o motivo
de cada recusa: um item inválido não derruba o lote.

## Como a interface conversa com o servidor

Ao abrir, a aplicação verifica `/api/saude`. Havendo servidor, ele passa a ser
a fonte dos dados: a interface carrega o estado completo, mantém uma cópia de
trabalho em memória para responder de imediato e envia cada gravação como
mutação. O que não conseguir ser enviado fica em fila no navegador e é reenviado
quando a conexão volta, com indicador próprio na barra superior. A cada 30
segundos, e sempre que a aba volta ao foco, a interface busca o que mudou desde
a última conversa, de modo que o trabalho de um usuário aparece para os demais.

Não havendo servidor, a aplicação continua funcionando com a base do próprio
navegador, como demonstração ou contingência.

Limite conhecido: a resolução de conflito é por registro, com prevalência da
última gravação. Duas pessoas editando o mesmo prazo ao mesmo tempo terminam
com o valor de quem gravou por último, e ambas as gravações ficam na auditoria.

## Segurança

- Senha guardada como scrypt com sal individual, comparada em tempo constante.
- Sessão em cookie `HttpOnly`, `SameSite=Lax`, com assinatura HMAC-SHA256. O
  JavaScript da página não lê o cookie, o que reduz o efeito de uma injeção.
- Cabeçalho próprio exigido em toda gravação, o que impede requisição forjada
  a partir de outro site.
- Bloqueio progressivo após cinco tentativas de acesso malsucedidas.
- Autorização no servidor, por perfil e permissão individual, a partir do mesmo
  arquivo de perfis usado pela interface (`sentinela/src/core/perfis.js`).
- Campos de controle (`criadoPor`, `excluidoEm`, hash de senha) são definidos
  pelo servidor e ignorados se vierem do navegador.
- Política de conteúdo restrita à própria origem, sem recurso externo.
- Nenhum dado sensível de usuário sai do servidor: hash e sal jamais são
  enviados à interface.

## Colocar no ar

**Rede do escritório.** Basta executar o servidor na máquina que fica ligada e
acessar pelo IP dela. Para uso em celular fora do escritório, publique com
HTTPS: sem TLS, senha e cookie trafegam em texto claro.

**Serviço permanente com systemd:**

```ini
[Unit]
Description=Sentinela
After=network.target

[Service]
Type=simple
User=sentinela
WorkingDirectory=/opt/sentinela/servidor
Environment=PORTA=3000
Environment=HOST=127.0.0.1
Environment=SENTINELA_HTTPS=true
Environment=SENTINELA_DADOS=/var/lib/sentinela
ExecStart=/usr/bin/node src/principal.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Com um proxy reverso na frente (Caddy resolve o certificado sozinho):

```
sentinela.seuescritorio.adv.br {
  reverse_proxy 127.0.0.1:3000
}
```

**Docker:**

```bash
# a partir da raiz do repositório, porque a imagem inclui a interface
docker build -t sentinela -f servidor/Dockerfile .
docker run -d -p 3000:3000 -v sentinela-dados:/dados \
  -e SENTINELA_ADMIN_SENHA='sua-senha-forte' sentinela
```

## Backup

Os dados ficam em `SENTINELA_DADOS`: `sentinela.db` (banco) e `segredo.chave`
(assinatura das sessões). Inclua esse diretório na rotina de cópia da máquina.
Com o serviço parado, copiar o diretório é suficiente. Com o serviço no ar, use
o utilitário do SQLite:

```bash
sqlite3 /var/lib/sentinela/sentinela.db ".backup '/backup/sentinela-$(date +%F).db'"
```

A exportação em JSON, dentro do sistema, serve como cópia adicional e para
inspeção — não substitui o backup do arquivo do banco.
