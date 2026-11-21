/* The two WebCrypto helpers the device needs (lock.js): random salt and
   PBKDF2-SHA256 at 100 000 rounds, as hex. */

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

export async function pbkdf2Hex(secret, saltHex, iterations = 100_000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
