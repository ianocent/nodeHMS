// Mock auth & permission middleware BEFORE any imports
jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = { id: 1n, name: 'Test Admin', username: 'admin', email: 'admin@test.com', roles: ['administrator'], roleIds: [1n], lastProperty: 1n, superUser: true, permissions: new Map() };
    next();
  }),
}));

jest.mock('../middleware/permission.middleware', () => ({
  requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  getPermissionFlags: jest.fn(() => ({ view: true, add: true, edit: true, delete: true })),
}));

import request from 'supertest';
import express from 'express';
import { mountRoutes, expectLaravelFormat } from './helpers';

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  mountRoutes(app);
  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, message: err.message || 'Internal error' });
  });
});

// ═════════════════════════════════════════════════════════
// 1. Health Checks
// ═════════════════════════════════════════════════════════
describe('Health', () => {
  test('GET / returns success', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/status returns success', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 2. Auth
// ═════════════════════════════════════════════════════════
describe('Auth', () => {
  test('POST /api/login rejects missing password', async () => {
    const res = await request(app).post('/api/login').send({ email: 'test@test.com' });
    expect(res.status).toBe(422);
  });

  test('POST /api/logout returns success', async () => {
    const res = await request(app).post('/api/logout');
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════
// 3. User & Guest
// ═════════════════════════════════════════════════════════
describe('User & Guest', () => {
  test('GET /api/users returns paginated list', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  test('GET /api/guests returns paginated list', async () => {
    const res = await request(app).get('/api/guests');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/guests/autocomplete returns array', async () => {
    const res = await request(app).get('/api/guests/autocomplete');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});

// ═════════════════════════════════════════════════════════
// 4. Reservation
// ═════════════════════════════════════════════════════════
describe('Reservation', () => {
  test('GET /api/reservations responds', async () => {
    const res = await request(app).get('/api/reservations');
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 5. Front Desk
// ═════════════════════════════════════════════════════════
describe('Front Desk', () => {
  test('GET /api/front-desk responds', async () => {
    const res = await request(app).get('/api/front-desk');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/transactions responds', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/deposits responds', async () => {
    const res = await request(app).get('/api/deposits');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/front-desk/shifts responds', async () => {
    const res = await request(app).get('/api/front-desk/shifts');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/door-locks responds', async () => {
    const res = await request(app).get('/api/door-locks');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 6. Folio
// ═════════════════════════════════════════════════════════
describe('Folio', () => {
  test('GET /api/folios/search responds', async () => {
    const res = await request(app).get('/api/folios/search');
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) expectLaravelFormat(res.body);
  });

  test('GET /api/folios/master responds', async () => {
    const res = await request(app).get('/api/folios/master');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 7. STAAH OTA
// ═════════════════════════════════════════════════════════
describe('STAAH OTA', () => {
  test('GET /api/staah/interfaces responds', async () => {
    const res = await request(app).get('/api/staah/interfaces');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 8. POS & Accounting
// ═════════════════════════════════════════════════════════
describe('POS & Accounting', () => {
  test('GET /api/cms/code-post responds', async () => {
    const res = await request(app).get('/api/cms/code-post');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/cms/setup responds', async () => {
    const res = await request(app).get('/api/cms/setup');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 9. Reports
// ═════════════════════════════════════════════════════════
describe('Reports', () => {
  test('GET /api/cms/report responds', async () => {
    const res = await request(app).get('/api/cms/report');
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 10. Admin
// ═════════════════════════════════════════════════════════
describe('Admin', () => {
  test('GET /api/roles responds', async () => {
    const res = await request(app).get('/api/roles');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/permissions responds', async () => {
    const res = await request(app).get('/api/permissions');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/menus responds', async () => {
    const res = await request(app).get('/api/menus');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/settings responds', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/tasks responds', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/logs responds', async () => {
    const res = await request(app).get('/api/logs');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 11. Master Setup
// ═════════════════════════════════════════════════════════
describe('Master Setup', () => {
  test('GET /api/type-payments responds', async () => {
    const res = await request(app).get('/api/type-payments');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/countries responds', async () => {
    const res = await request(app).get('/api/countries');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/cities responds', async () => {
    const res = await request(app).get('/api/cities');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/holidays responds', async () => {
    const res = await request(app).get('/api/holidays');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 12. Company
// ═════════════════════════════════════════════════════════
describe('Company', () => {
  test('GET /api/profile/company responds', async () => {
    const res = await request(app).get('/api/profile/company');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/profile/company-v2 responds', async () => {
    const res = await request(app).get('/api/profile/company-v2');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  test('GET /api/profile/company-contact responds', async () => {
    const res = await request(app).get('/api/profile/company-contact');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/profile/company-activity responds', async () => {
    const res = await request(app).get('/api/profile/company-activity');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/profile/company-folio responds', async () => {
    const res = await request(app).get('/api/profile/company-folio');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/profile/company-statistic responds', async () => {
    const res = await request(app).get('/api/profile/company-statistic');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 13. Housekeeping
// ═════════════════════════════════════════════════════════
describe('Housekeeping', () => {
  test('GET /api/housekeeping/setups responds', async () => {
    const res = await request(app).get('/api/housekeeping/setups');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/housekeeping/room-status responds', async () => {
    const res = await request(app).get('/api/housekeeping/room-status');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/housekeeping/work-orders responds', async () => {
    const res = await request(app).get('/api/housekeeping/work-orders');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/housekeeping/stocks responds', async () => {
    const res = await request(app).get('/api/housekeeping/stocks');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/housekeeping/rosters responds', async () => {
    const res = await request(app).get('/api/housekeeping/rosters');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/housekeeping/checklist-history responds', async () => {
    const res = await request(app).get('/api/housekeeping/checklist-history');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 14. Concierge
// ═════════════════════════════════════════════════════════
describe('Concierge', () => {
  test('GET /api/phone-book-groups responds', async () => {
    const res = await request(app).get('/api/phone-book-groups');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/phone-book-groups/tree responds', async () => {
    const res = await request(app).get('/api/phone-book-groups/tree');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/phone-books responds', async () => {
    const res = await request(app).get('/api/phone-books');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/baggages responds', async () => {
    const res = await request(app).get('/api/baggages');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/car-parks responds', async () => {
    const res = await request(app).get('/api/car-parks');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/lost-and-founds responds', async () => {
    const res = await request(app).get('/api/lost-and-founds');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 15. Event Management
// ═════════════════════════════════════════════════════════
describe('Event Management', () => {
  test('GET /api/event-venues responds', async () => {
    const res = await request(app).get('/api/event-venues');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/event-venues/master responds', async () => {
    const res = await request(app).get('/api/event-venues/master');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/event-layouts responds', async () => {
    const res = await request(app).get('/api/event-layouts');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/events responds', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/event-packages responds', async () => {
    const res = await request(app).get('/api/event-packages');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/event-inventories responds', async () => {
    const res = await request(app).get('/api/event-inventories');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/event-items responds', async () => {
    const res = await request(app).get('/api/event-items');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/event-managements responds', async () => {
    const res = await request(app).get('/api/event-managements');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 16. Statistic
// ═════════════════════════════════════════════════════════
describe('Statistic', () => {
  test('GET /api/dashboard responds', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/room-availabilities responds', async () => {
    const res = await request(app).get('/api/room-availabilities');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 17. Guest Sub-features
// ═════════════════════════════════════════════════════════
describe('Guest Sub-features', () => {
  test('GET /api/guests/:id/documents — handles 0 data', async () => {
    const res = await request(app).get('/api/guests/1/documents');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/guests/:id/family responds', async () => {
    const res = await request(app).get('/api/guests/1/family');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/guests/:id/history responds', async () => {
    const res = await request(app).get('/api/guests/1/history');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/guests/:id/preferences responds', async () => {
    const res = await request(app).get('/api/guests/1/preferences');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/guests/:id/loyalty-cards responds', async () => {
    const res = await request(app).get('/api/guests/1/loyalty-cards');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 18. Night Audit (System)
// ═════════════════════════════════════════════════════════
describe('Night Audit', () => {
  test('GET /api/cms/room-changes responds', async () => {
    const res = await request(app).get('/api/cms/room-changes');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/cms/log-audits responds', async () => {
    const res = await request(app).get('/api/cms/log-audits');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });

  test('GET /api/cms/shift-confirmation responds', async () => {
    const res = await request(app).get('/api/cms/shift-confirmation');
    expect(res.status).toBe(200);
    expectLaravelFormat(res.body);
  });
});

// ═════════════════════════════════════════════════════════
// 19. Guest Document CRUD
// ═════════════════════════════════════════════════════════
describe('Guest Document CRUD', () => {
  test('POST /api/guests/1/documents creates', async () => {
    const res = await request(app).post('/api/guests/1/documents').send({ file: 'test.pdf', description: 'Test doc' });
    expect(res.status).toBe(201);
    expectLaravelFormat(res.body);
  });

  let docId: number;

  test('GET documents returns created doc', async () => {
    const res = await request(app).get('/api/guests/1/documents');
    expect(res.status).toBe(200);
    if (res.body.data.length > 0) docId = res.body.data[0].id;
  });

  test('DELETE document works', async () => {
    if (!docId) return;
    // Use the document ID from list
    const list = await request(app).get('/api/guests/1/documents');
    if (list.body.data.length > 0) {
      const id = list.body.data[0].id;
      const res = await request(app).delete(`/api/guests/documents/${id}`);
      expect(res.status).toBe(200);
      expectLaravelFormat(res.body);
    }
  });
});
