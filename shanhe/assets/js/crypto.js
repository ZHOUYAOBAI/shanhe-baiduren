/* ============================================================
   《山河摆渡人》剧本站 · 剧本正文解密模块
   与 encrypt_spoiler.py 参数严格一致
   ============================================================ */
export const SALT_B64 = 'c2hhbmhlLWJhaWR1cmVuLzIwMjYtcmVhZA==';
export const ITERATIONS = 150000;
const KEY_LEN = 32;
const IV_LEN = 12;

/* base64 → ArrayBuffer */
function b64ToBuf(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

/* 密码 → 256bit 密钥（PBKDF2-HMAC-SHA256，与 Python 端一致） */
export async function deriveKey(password) {
  const salt = b64ToBuf(SALT_B64);
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: KEY_LEN * 8 },
    false,
    ['decrypt']
  );
}

/* 解密整体密文块，返回 {acts:[...], songs:[...]} */
export async function decryptSecret(password, ivB64, cipherB64) {
  const key = await deriveKey(password);
  const iv = b64ToBuf(ivB64);
  const ct = b64ToBuf(cipherB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}
