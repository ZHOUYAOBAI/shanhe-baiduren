/* ============================================================
   剧本站 · 剧本正文解密模块
   ------------------------------------------------------------
   与构建端（scripts/build-data.mjs）参数严格一致：
     PBKDF2-HMAC-SHA256(password, salt, iterations) → 256bit
     AES-256-GCM
   salt / iterations 随密文一起存放于 data.js，故本模块不写死。
   ============================================================ */

const DEFAULT_ITERATIONS = 150000;
const KEY_LEN = 32;

function b64ToBuf(b64) {
  const bin = atob(String(b64 || ''));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

export function isCryptoAvailable() {
  return typeof crypto !== 'undefined'
    && crypto.subtle
    && typeof crypto.subtle.deriveKey === 'function';
}

/* 密码 → 256bit 密钥 */
export async function deriveKey(password, saltB64, iterations = DEFAULT_ITERATIONS) {
  const salt = b64ToBuf(saltB64);
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: KEY_LEN * 8 },
    false,
    ['decrypt']
  );
}

/**
 * 解密密文块。
 * @param {string} password
 * @param {{salt:string, iterations?:number, iv:string, cipher:string}} secret
 * @returns {Promise<object>} 明文对象；密码错误时抛错
 */
export async function decryptSecret(password, secret) {
  if (!secret || !secret.cipher) throw new Error('NO_SECRET');
  if (!isCryptoAvailable()) throw new Error('NO_WEBCRYPTO');

  const iterations = secret.iterations || DEFAULT_ITERATIONS;
  const key = await deriveKey(password, secret.salt, iterations);
  const iv = b64ToBuf(secret.iv);
  const ct = b64ToBuf(secret.cipher);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}
