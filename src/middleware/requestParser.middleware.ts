import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

const AES_METHOD = 'aes-256-cbc';
const getAesPassword = (): string => process.env.APP_AES_PASSWORD || '';

/**
 * Auto-parse encrypted request body (AES-256-CBC) like Laravel DecryptRequestMiddleware.
 * If Content-Type is text/plain, decrypts body using APP_AES_PASSWORD.
 * Format: iv_hex:ciphertext_hex (matches Laravel openssl_encrypt with OPENSSL_RAW_DATA)
 * Also sets CORS headers (replaces custom CorsMiddleware).
 * Also converts 201 → 200 (replaces ModifyStatusCode).
 */
export function requestParser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Token, X-Property-Id, Authorization, Accept'
  );

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  // AES-256-CBC decryption for text/plain (matches Laravel DecryptRequestMiddleware)
  // Format: iv_hex:ciphertext_hex
  if (req.headers['content-type'] === 'text/plain' && req.body) {
    try {
      const encrypted = req.body.toString();
      const decrypted = decryptAES(encrypted);
      const parsed = JSON.parse(decrypted);
      req.body = parsed;
    } catch (err) {
      console.error('AES decryption failed:', err);
      // Continue with original body if decryption fails
    }
  }

  // Trim strings and convert empty/null-like strings to null (Laravel behavior)
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
        if (req.body[key] === '' || req.body[key] === 'null') {
          req.body[key] = null;
        }
      }
    }
  }

  // Normalize query params: string "null" → null, string "undefined" → undefined
  for (const key of Object.keys(req.query)) {
    const val = req.query[key];
    if (typeof val === 'string') {
      if (val === 'null') {
        (req.query as any)[key] = null;
      } else if (val === 'undefined') {
        (req.query as any)[key] = undefined;
      }
    }
  }

  // Response encryption for text/plain responses (matches Laravel EncryptResponseMiddleware)
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode === 201) {
      res.status(200);
    }

    // Encrypt response when request was text/plain (AES handshake) or Accept header set
    const incomingWasEncrypted = req.headers['content-type'] === 'text/plain';
    if (incomingWasEncrypted || req.headers.accept === 'text/plain' || req.query.encrypt === 'true') {
      const encrypted = encryptAES(JSON.stringify(body));
      res.setHeader('Content-Type', 'text/plain');
      return res.send(encrypted);
    }

    return originalJson(body);
  };

  next();
}

function decryptAES(ciphered: string): string {
  const parts = ciphered.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid AES format: expected iv_hex:ciphertext_hex');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const ciphertext = Buffer.from(parts[1], 'hex');

  const decipher = crypto.createDecipheriv(AES_METHOD, getAesPassword(), iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function encryptAES(message: string): string {
  const IV_SIZE = 16; // AES-256-CBC uses 16-byte IV
  const iv = crypto.randomBytes(IV_SIZE);
  const cipher = crypto.createCipheriv(AES_METHOD, getAesPassword(), iv);
  cipher.setAutoPadding(true);
  const ciphertext = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
  const ivHex = iv.toString('hex');
  const ciphertextHex = ciphertext.toString('hex');
  return `${ivHex}:${ciphertextHex}`;
}
