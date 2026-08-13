import * as crypto from 'crypto';

const AES_METHOD = 'aes-256-cbc';
const AES_PASSWORD = process.env.APP_AES_PASSWORD;
if (!AES_PASSWORD) {
  throw new Error('APP_AES_PASSWORD is not set in environment');
}
const IV_SIZE = 16; // AES-256-CBC uses 16-byte IV

/**
 * AES-256-CBC encryption matching Laravel's encryptAES()
 * Format: iv_hex:ciphertext_hex
 */
export function encryptAES(plaintext: string): string {
  const iv = crypto.randomBytes(IV_SIZE);
  const cipher = crypto.createCipheriv(AES_METHOD, AES_PASSWORD, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const ivHex = iv.toString('hex');
  const ciphertextHex = ciphertext.toString('hex');

  return `${ivHex}:${ciphertextHex}`;
}

/**
 * AES-256-CBC decryption matching Laravel's decryptAES()
 * Expects format: iv_hex:ciphertext_hex
 */
export function decryptAES(ciphered: string): string {
  if (!ciphered) return '';

  const parts = ciphered.split(':');
  if (parts.length !== 2) return '';

  const iv = Buffer.from(parts[0], 'hex');
  const ciphertext = Buffer.from(parts[1], 'hex');

  const decipher = crypto.createDecipheriv(AES_METHOD, AES_PASSWORD, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return plaintext.toString('utf8');
}

/**
 * Decrypt request body if Content-Type is text/plain
 * Replicates Laravel DecryptRequestMiddleware
 */
export function decryptRequestBody(body: string): any {
  if (!body) return {};
  try {
    const decrypted = decryptAES(body);
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

/**
 * Encrypt response body for production
 * Replicates Laravel EncryptResponseMiddleware
 */
export function encryptResponseBody(body: string): string {
  return encryptAES(body);
}