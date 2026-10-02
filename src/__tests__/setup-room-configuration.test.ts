// Room-configuration add must accept the multipart `file` field the same way
// Laravel TypeController@store does (routes/cms.php -> Route::resource('setup')).
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
import { mountRoutes, parseBody } from './helpers';

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

// 1x1 transparent PNG - smallest valid image payload.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

describe('Room Configuration setup (types group=room-configuration)', () => {
  const uniq = `RC-TEST-${Date.now()}`;
  const uniq2 = `${uniq}-B`;
  let createdId: number | undefined;
  let otherId: number | undefined;
  const { prisma } = require('../config/prisma');

  const hardDelete = async (id?: number) => {
    if (!id) return;
    await prisma.types.delete({ where: { id: BigInt(id) } }).catch(() => undefined);
  };

  it('add with image file succeeds (multipart field name "file")', async () => {
    const res = await request(app)
      .post('/api/cms/setup?group=room-configuration')
      .field('name', uniq)
      .field('status', 'true')
      .attach('file', PNG_1PX, { filename: 'rc.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body.code).toBe(200);
    if (body?.data?.id) createdId = Number(body.data.id);
  });

  it('created record stored the uploaded image path', async () => {
    expect(createdId).toBeDefined();
    const res = await request(app).get(`/api/cms/setup/${createdId}`);
    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body?.data?.image).toEqual(expect.stringContaining('types/'));
  });

  it('rejects duplicate name in the same group', async () => {
    const res = await request(app)
      .post('/api/cms/setup?group=room-configuration')
      .field('name', uniq)
      .field('status', 'true');
    expect(res.status).toBe(400);
    expect(parseBody(res).message).toMatch(/already exist/i);
  });

  it('edit replaces the image via update-file', async () => {
    const res = await request(app)
      .post(`/api/cms/setup/${createdId}/update-file?group=room-configuration`)
      .field('name', uniq)
      .field('status', 'true')
      .attach('file', PNG_1PX, { filename: 'rc2.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(parseBody(res).code).toBe(200);
  });

  // Laravel TypeController@update:422 / @updateWithFile:498 - both reject a name
  // that another row in the same group already uses.
  describe('duplicate name on edit', () => {
    beforeAll(async () => {
      const res = await request(app)
        .post('/api/cms/setup?group=room-configuration')
        .field('name', uniq2)
        .field('status', 'true');
      expect(res.status).toBe(200);
      otherId = Number(parseBody(res)?.data?.id);
    });

    afterAll(async () => { await hardDelete(otherId); });

    it('PUT rejects renaming onto another row in the same group', async () => {
      const res = await request(app)
        .put(`/api/cms/setup/${otherId}?group=room-configuration`)
        .send({ name: uniq, status: 1 });
      expect(res.status).toBe(400);
      expect(parseBody(res).message).toMatch(/already exist/i);
    });

    it('update-file rejects renaming onto another row in the same group', async () => {
      const res = await request(app)
        .post(`/api/cms/setup/${otherId}/update-file?group=room-configuration`)
        .field('name', uniq)
        .field('status', 'true');
      expect(res.status).toBe(400);
      expect(parseBody(res).message).toMatch(/already exist/i);
    });

    it('keeping its own name is not treated as a duplicate', async () => {
      const res = await request(app)
        .put(`/api/cms/setup/${otherId}?group=room-configuration`)
        .send({ name: uniq2, status: 1 });
      expect(res.status).toBe(200);
    });

    it('a partial update that omits name is not blocked', async () => {
      const res = await request(app)
        .put(`/api/cms/setup/${otherId}?group=room-configuration`)
        .send({ status: 1 });
      expect(res.status).toBe(200);
    });
  });

  it('cleans up the test record', async () => {
    // DELETE /setup/:id is a soft delete (Laravel TypeController@destroy); the test
    // row has to be hard-deleted so repeated runs do not pile up rows.
    await hardDelete(createdId);
    await hardDelete(otherId);
  });
});

// Regression: Laravel TypeController@index:52 always returns `search_data`.
// When it was missing, the frontend stored `undefined` in `datavalsrc` and every
// later refetch threw `Cannot read properties of undefined (reading 'status')`,
// which was swallowed into the error banner and unmounted the whole table -- so
// clicking "+ Add" rendered no form and never issued a POST.
describe('GET /setup response contract', () => {
  it('always includes an object search_data with status + search keys', async () => {
    const res = await request(app).get('/api/cms/setup?group=room-configuration');
    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body.code).toBe(200);

    const sd = body?.search_data ?? body?.data?.search_data;
    expect(sd).toBeDefined();
    expect(Array.isArray(sd)).toBe(false);
    expect(sd).toHaveProperty('status');
    expect(sd.status).toEqual({ value: '-1', label: 'ALL' });
    expect(sd).toHaveProperty('search', '');
  });

  it('echoes applied select filters back as {label, value}', async () => {
    const res = await request(app).get(
      '/api/cms/setup?group=room-configuration&search_field=status&search_value=1'
    );
    expect(res.status).toBe(200);
    const sd = parseBody(res)?.search_data ?? parseBody(res)?.data?.search_data;
    expect(sd.status).toEqual({ value: '1', label: sd.status.label });
    expect(sd.status.value).toBe('1');
  });
});