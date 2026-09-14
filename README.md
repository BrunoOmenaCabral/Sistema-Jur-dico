# Sentinela — Gestão Jurídica

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

## Testes

```bash
node sentinela/testes/testes.mjs   # regras de prazo, publicações e conflitos
node servidor/testes/testes.mjs    # autenticação, permissões e sincronização
```

## Aviso

Os dados do escritório ficam em `servidor/dados`, fora do controle de versão.
Nunca envie essa pasta nem backups em JSON para um repositório: eles contêm
informação de clientes e processos, protegida por sigilo profissional.
