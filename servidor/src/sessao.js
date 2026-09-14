// Sessões e senhas.
//
// A senha é guardada como scrypt com sal individual. A sessão trafega em cookie
// httpOnly assinado com HMAC-SHA256: o conteúdo é legível, mas não pode ser
// forjado sem o segredo do servidor.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config, segredo } from './config.js';

const PARAMETROS_SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function gerarHashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync(senha, sal, PARAMETROS_SCRYPT.keylen, PARAMETROS_SCRYPT).toString('hex');
  return { hash, sal };
}

export function senhaConfere(senha, hash, sal) {
  const calculado = scryptSync(senha, sal, PARAMETROS_SCRYPT.keylen, PARAMETROS_SCRYPT);
  const guardado = Buffer.from(hash, 'hex');
  return guardado.length === calculado.length && timingSafeEqual(calculado, guardado);
}

const assinar = (texto) => createHmac('sha256', segredo).update(texto).digest('base64url');

export function criarToken(usuarioId) {
  const carga = JSON.stringify({
    usuarioId,
    expira: Date.now() + config.duracaoSessaoHoras * 3600 * 1000,
    nonce: randomBytes(8).toString('base64url'),
  });
  const corpo = Buffer.from(carga).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

export function lerToken(token) {
  if (!token || !token.includes('.')) return null;
  const [corpo, assinatura] = token.split('.');
  const esperado = assinar(corpo);
  if (assinatura.length !== esperado.length) return null;
  if (!timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))) return null;
  try {
    const carga = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return carga.expira > Date.now() ? carga : null;
  } catch { return null; }
}

export const NOME_COOKIE = 'sentinela_sessao';

export function cookieDeSessao(token) {
  const partes = [
    `${NOME_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${config.duracaoSessaoHoras * 3600}`,
  ];
  if (config.seguro) partes.push('Secure');
  return partes.join('; ');
}

export const cookieDeSaida = () =>
  `${NOME_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.seguro ? '; Secure' : ''}`;

export function lerCookies(cabecalho = '') {
  return Object.fromEntries(String(cabecalho).split(';').map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
  }).filter(([k]) => k));
}

/* Controle de tentativas de acesso, por e-mail e origem. */
const tentativas = new Map();

export function registrarFalha(chave) {
  const atual = tentativas.get(chave) || { n: 0, bloqueadoAte: 0 };
  atual.n += 1;
  if (atual.n >= 5) {
    atual.bloqueadoAte = Date.now() + Math.min(15, 2 ** (atual.n - 5)) * 60 * 1000;
  }
  tentativas.set(chave, atual);
}

export const limparFalhas = (chave) => tentativas.delete(chave);

export function bloqueado(chave) {
  const atual = tentativas.get(chave);
  if (!atual) return 0;
  const restante = atual.bloqueadoAte - Date.now();
  return restante > 0 ? Math.ceil(restante / 1000) : 0;
}
