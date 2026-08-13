// Load .env (APP_AES_PASSWORD etc.) before any module that needs it
import 'dotenv/config';

import express from 'express';
import { Request, Response, NextFunction } from 'express';

// Re-export test user — matches AuthUser interface
export const TEST_USER = {
  id: 1n,
  name: 'Test Admin',
  username: 'admin',
  email: 'admin@test.com',
  roles: ['administrator'],
  roleIds: [1n],
  lastProperty: 1n,
  superUser: true,
  permissions: new Map(),
};

// Mount all routes — called after jest.mock setup
export function mountRoutes(app: express.Express): void {
  // Auth routes (login is public)
  app.use('/api', require('../routes/auth.routes').default);
  app.use('/api', require('../routes/user-guest.routes').default);
  app.use('/api', require('../routes/reservation.routes').default);
  app.use('/api', require('../routes/rate.routes').default);
  app.use('/api', require('../routes/room.routes').default);
  app.use('/api', require('../routes/front-desk.routes').default);
  app.use('/api', require('../routes/folio.routes').default);
  app.use('/api', require('../routes/staah.routes').default);
  app.use('/api', require('../routes/master-system.routes').default);
  app.use('/api', require('../routes/report.routes').default);
  app.use('/api', require('../routes/admin.routes').default);
  app.use('/api', require('../routes/master-setup.routes').default);
  app.use('/api', require('../routes/company.routes').default);
  app.use('/api', require('../routes/housekeeping.routes').default);
  app.use('/api', require('../routes/concierge.routes').default);
  app.use('/api', require('../routes/event.routes').default);
  app.use('/api', require('../routes/statistic.routes').default);
}

// Check if response matches Laravel format
export function expectLaravelFormat(body: any): void {
  expect(body).toHaveProperty('success');
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('message');
}
