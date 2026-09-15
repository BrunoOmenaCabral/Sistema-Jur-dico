# Jursistemy — Gestão Jurídica

Sistema de gestão de escritório de advocacia orientado a um único objetivo
central: **impedir que um prazo importante passe despercebido.**

## Executar

```bash
cd servidor
npm start
# abra http://localhost:3000
```

Requer apenas Node.js 22 ou superior. No primeiro início o terminal mostra o
e-mail e a senha do administrador.

## Onde está cada coisa

| Pasta | Conteúdo |
| --- | --- |
| `sentinela/` | Aplicação: interface, regras de prazo, publicações e relatórios |
| `servidor/` | Backend: API, banco de dados, autenticação e permissões |
| `sentinela/docs/` | Arquitetura, regras de contagem de prazo e etapas seguintes |

Instruções de uso, testes e publicação com HTTPS em
[`sentinela/README.md`](sentinela/README.md) e
[`servidor/README.md`](servidor/README.md).

## Publicação da interface

A interface não tem etapa de compilação: é HTML, CSS e módulos ES servidos como
arquivos estáticos. Sem backend respondendo em `/api/saude`, o sistema entra em
modo local e guarda os dados no navegador de quem usa.

| Destino | Como |
| --- | --- |
| GitHub Pages | Fluxo em `.github/workflows/pages.yml`, que publica a pasta `sentinela/` |
| Vercel | `vercel.json` aponta `outputDirectory` para `sentinela/` |

A raiz do repositório não tem `index.html`, porque a aplicação vive em
`sentinela/`. Qualquer hospedagem estática precisa ser apontada para essa pasta,
sob pena de responder 404.

O backend em `servidor/` não acompanha essas publicações: exige processo Node
contínuo e disco que sobreviva a reinício, para o banco e a chave de sessão.

## Testes

```bash
node sentinela/testes/testes.mjs   # regras de prazo, publicações e conflitos
node servidor/testes/testes.mjs    # autenticação, permissões e sincronização
```

## Aviso

Os dados do escritório ficam em `servidor/dados`, fora do controle de versão.
Nunca envie essa pasta nem backups em JSON para um repositório: eles contêm
informação de clientes e processos, protegida por sigilo profissional.
