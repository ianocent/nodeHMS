import crypto from 'crypto';

const AES_METHOD = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey(): Buffer {
  const pass = process.env.APP_AES_PASSWORD;
  if (!pass) {
    throw new Error('APP_AES_PASSWORD is not set in environment');
  }
  return Buffer.from(pass, 'utf8');
}

export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_METHOD, getKey(), iv);
  let encrypted = cipher.update(plainText, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(encryptedText: string): string {
  const textParts = encryptedText.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encrypted = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(AES_METHOD, getKey(), iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}
