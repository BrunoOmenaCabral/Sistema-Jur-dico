# Regras de contagem adotadas

O motor está em `src/core/calculo-prazo.js` e o calendário em `src/core/feriados.js`.
Toda apuração devolve a memória de cálculo, que é gravada junto ao prazo em
`regraCalculo` e exibida na ficha.

## Fundamentos aplicados

| Situação | Regra | Fundamento |
| --- | --- | --- |
| Prazo processual em dias | Computam-se apenas os dias úteis | art. 219 do CPC |
| Publicação em diário eletrônico | Considera-se publicado no primeiro dia útil seguinte à disponibilização | art. 224, §2º, do CPC |
| Termo inicial | Exclui-se o dia do começo; a contagem inicia no primeiro dia útil seguinte | art. 224, caput e §3º, do CPC |
| Termo final em dia sem expediente | Prorroga-se para o primeiro dia útil seguinte | art. 224, §1º, do CPC |
| Recesso forense | Prazos suspensos entre 20 de dezembro e 20 de janeiro | art. 220 do CPC |
| Prazo em dobro | Multiplicador aplicado sobre a quantidade de dias | arts. 183, 186 e 229 do CPC |

Prazos de natureza material, penal e os previstos em legislação específica são
contados em dias corridos, opção disponível em cada cadastro e em cada cálculo.

## Feriados

- **Nacionais fixos**: 1º de janeiro, 21 de abril, 1º de maio, 7 de setembro,
  12 de outubro, 2 e 15 de novembro, 20 de novembro (Lei 14.759/2023) e 25 de dezembro.
- **Nacionais móveis**: carnaval (segunda e terça), sexta-feira santa e Corpus Christi,
  derivados da Páscoa pelo algoritmo de Meeus/Jones/Butcher — funcionam para qualquer ano.
- **Estaduais, municipais e de tribunal**: cadastrados em Configurações › Calendário
  forense, aplicados conforme a UF, a comarca e o tribunal do processo.
- **Suspensões de expediente**: períodos com data inicial e final, aplicados por
  abrangência.

## Limites conhecidos

1. O calendário de cada tribunal precisa ser alimentado pelo escritório. O sistema não
   consulta portarias automaticamente.
2. Prazos com regra própria (execução fiscal, juizados, justiça do trabalho, matéria
   penal) devem ter a contagem escolhida no cadastro. O sistema nunca presume que todo
   prazo é em dias úteis, e registra a regra que foi de fato utilizada.
3. A sugestão automática a partir da publicação é apoio à conferência, jamais decisão.
   O prazo só existe depois da confirmação do advogado.
