// Mock auth & permission middleware BEFORE any imports
jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = { id: 1n, name: 'Test Admin', username: 'admin', email: 'admin@test.com', roles: ['administrator'], roleIds: [1n], lastProperty: 999n, superUser: true, permissions: new Map() };
    next();
  }),
}));

jest.mock('../middleware/permission.middleware', () => ({
  requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  getPermissionFlags: jest.fn(() => ({ view: true, add: true, edit: true, delete: true })),
}));

import request from 'supertest';
import express from 'express';
import { mountRoutes } from './helpers';

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  mountRoutes(app);
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, message: err.message || 'Internal error' });
  });
});

describe('Report Excel exports', () => {
  test('account daily-sales-report returns Excel', async () => {
    const res = await request(app).get('/api/cms/report/account/daily-sales-report?typeOps=view&date=2024-01-01');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
  }, 20000);

  test('batch frontoffice daily-sales-report returns Excel', async () => {
    const res = await request(app).get('/api/cms/report/batch/frontoffice/daily-sales-report?typeOps=view&date=2024-01-01');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
  }, 20000);

  test('room-division report returns Excel', async () => {
    const res = await request(app).get('/api/cms/report/batch/after-night-audit/room-division?typeOps=view&date=2024-01-01');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
  }, 20000);
});
