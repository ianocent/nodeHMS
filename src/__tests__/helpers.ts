// Load .env (APP_AES_PASSWORD etc.) before any module that needs it
import 'dotenv/config';

import express from 'express';
import { Request, Response } from 'express';
import { decrypt } from '../utils/encryption';
import { success } from '../utils/response';

// Re-export test user — matches AuthUser interface
export const TEST_USER = {
  id: 1n,
  name: 'Test Admin',
  username: 'admin',
  email: 'admin@test.com',
  roles: ['administrator'],
  roleIds: [1n],
  lastProperty: 999n, // property 999 exists in the dev DB (1 does not)
  superUser: true,
  permissions: new Map(),
};

const mountLegacyCmsAlias = (app: express.Express, router: any): void => {
  app.use('/api/cms', router);
};

// Mount all routes — called after jest.mock setup
export function mountRoutes(app: express.Express): void {
  // Health check (mirrors src/index.ts)
  app.get('/', (_req: Request, res: Response) => {
    success(res, { version: '1.0.0', name: 'HMS Anyaman Node.js Backend' }, 'Server running');
  });
  app.get('/api/status', (_req: Request, res: Response) => {
    success(res, { db: 'connected', phase: 4 }, 'API operational');
  });

  // Auth routes (login is public)
  app.use('/api', require('../routes/auth.routes').default);
  mountLegacyCmsAlias(app, require('../routes/auth.routes').default);
  app.use('/api', require('../routes/user-guest.routes').default);
  mountLegacyCmsAlias(app, require('../routes/user-guest.routes').default);
  app.use('/api', require('../routes/reservation.routes').default);
  mountLegacyCmsAlias(app, require('../routes/reservation.routes').default);
  app.use('/api', require('../routes/rate.routes').default);
  mountLegacyCmsAlias(app, require('../routes/rate.routes').default);
  app.use('/api', require('../routes/room.routes').default);
  mountLegacyCmsAlias(app, require('../routes/room.routes').default);
  app.use('/api', require('../routes/front-desk.routes').default);
  mountLegacyCmsAlias(app, require('../routes/front-desk.routes').default);
  app.use('/api', require('../routes/folio.routes').default);
  mountLegacyCmsAlias(app, require('../routes/folio.routes').default);
  app.use('/api', require('../routes/staah.routes').default);
  mountLegacyCmsAlias(app, require('../routes/staah.routes').default);
  app.use('/api', require('../routes/master-system.routes').default);
  mountLegacyCmsAlias(app, require('../routes/master-system.routes').default);
  app.use('/api', require('../routes/report.routes').default);
  app.use('/api', require('../routes/admin.routes').default);
  mountLegacyCmsAlias(app, require('../routes/admin.routes').default);
  app.use('/api', require('../routes/master-setup.routes').default);
  mountLegacyCmsAlias(app, require('../routes/master-setup.routes').default);
  app.use('/api', require('../routes/company.routes').default);
  mountLegacyCmsAlias(app, require('../routes/company.routes').default);
  app.use('/api', require('../routes/housekeeping.routes').default);
  mountLegacyCmsAlias(app, require('../routes/housekeeping.routes').default);
  app.use('/api', require('../routes/concierge.routes').default);
  mountLegacyCmsAlias(app, require('../routes/concierge.routes').default);
  app.use('/api', require('../routes/event.routes').default);
  mountLegacyCmsAlias(app, require('../routes/event.routes').default);
  app.use('/api', require('../routes/statistic.routes').default);
  mountLegacyCmsAlias(app, require('../routes/statistic.routes').default);
  app.use('/api/generic', require('../routes/generic.routes').default);
  app.use('/api', require('../routes/extra.routes').default);
  mountLegacyCmsAlias(app, require('../routes/extra.routes').default);
  app.use('/api', require('../routes/content.routes').default);
  mountLegacyCmsAlias(app, require('../routes/content.routes').default);
}

// All /cms responses are AES-256-CBC encrypted (iv:cipher, text/plain) so supertest
// keeps the ciphertext in res.text and leaves res.body as {}. Decrypt + JSON.parse
// to get the Laravel-shaped object. Accepts the supertest response or raw text.
export function parseBody(resOrText: any): any {
  const text =
    typeof resOrText === 'string' ? resOrText : resOrText?.text ?? resOrText?.body;
  if (typeof text === 'string' && text.includes(':')) {
    try {
      return JSON.parse(decrypt(text));
    } catch {
      return text;
    }
  }
  return typeof text === 'string' ? text : resOrText?.body ?? resOrText;
}

// Check if response matches the backend contract (code/data/message — frontend checks code == "200")
export function expectLaravelFormat(res: any): void {
  const parsed = parseBody(res);
  expect(parsed).toHaveProperty('code');
  expect(parsed).toHaveProperty('data');
  expect(parsed).toHaveProperty('message');
}
