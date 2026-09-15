// Envio de e-mail pelo servidor.
//
// O projeto não tem dependências externas, então o envio não é por SMTP e sim
// por API HTTP do provedor contratado, com uma requisição simples. O formato
// padrão é o da API do Resend, que a maioria dos provedores modernos imita;
// endereço e nomes de campo podem ser trocados por variável de ambiente.
//
// Sem provedor configurado nada é inventado: a função informa que não enviou,
// e quem chamou decide o que fazer com isso.

import { config } from './config.js';

export const disponivel = () =>
  Boolean(config.email.endpoint && config.email.chave && config.email.remetente);

/**
 * @returns {Promise<{enviado:boolean, motivo?:string}>}
 */
export async function enviar({ para, assunto, texto }) {
  if (!disponivel()) {
    return { enviado: false,
      motivo: 'Nenhum provedor de e-mail configurado no servidor. Defina SENTINELA_EMAIL_ENDPOINT, '
        + 'SENTINELA_EMAIL_CHAVE e SENTINELA_EMAIL_REMETENTE.' };
  }

  try {
    const resposta = await fetch(config.email.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.email.remetente,
        to: [para],
        subject: assunto,
        text: texto,
      }),
      signal: AbortSignal.timeout(config.tempoLimiteConsultaMs),
    });
    if (!resposta.ok) {
      return { enviado: false, motivo: `O provedor de e-mail respondeu ${resposta.status}.` };
    }
    return { enviado: true };
  } catch (e) {
    return { enviado: false, motivo: `Falha ao enviar o e-mail: ${e.message}` };
  }
}
