import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { requestParser } from '../middleware/requestParser.middleware';

const AES_METHOD = 'aes-256-cbc';
const IV_LENGTH = 16;
const APP_AES_PASSWORD = '0123456789abcdef0123456789abcdef';

function encryptAES(message: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_METHOD, Buffer.from(APP_AES_PASSWORD), iv);
  const ciphertext = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptAES(ciphered: string): string {
  const [ivHex, ciphertextHex] = ciphered.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv(AES_METHOD, Buffer.from(APP_AES_PASSWORD), iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

describe('requestParser AES body parsing', () => {
  const original = process.env.APP_AES_PASSWORD;

  beforeAll(() => {
    process.env.APP_AES_PASSWORD = APP_AES_PASSWORD;
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.APP_AES_PASSWORD;
    } else {
      process.env.APP_AES_PASSWORD = original;
    }
  });

  test('decrypts text/plain payloads sent with charset parameter', async () => {
    const app = express();
    app.use(express.text({ type: 'text/plain' }));
    app.use(requestParser);
    app.post('/decrypt-test', (req, res) => {
      res.json(req.body);
    });

    const payload = { email: 'dev@dipstrategy.com', password: 'secret' };
    const encrypted = encryptAES(JSON.stringify(payload));

    const response = await request(app)
      .post('/decrypt-test')
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send(encrypted);

    expect(response.status).toBe(200);
    expect(response.text).toBeDefined();

    const decryptedBody = decryptAES(response.text);
    expect(JSON.parse(decryptedBody)).toMatchObject(payload);
  });
});
