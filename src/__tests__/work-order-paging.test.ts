/**
 * Work order list paging.
 *
 * `housekeeping.controller.ts@workOrderList` used to call `parsePagination` but
 * throw the result away — `findMany` had no `take`/`skip`, so every request
 * pulled the whole property's work orders with three joins each, and the
 * response carried no usable `pagging` block for the table pager.
 */
jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      id: 1n,
      name: 'Test Admin',
      username: 'admin',
      email: 'admin@test.com',
      roles: ['administrator'],
      roleIds: [1n],
      lastProperty: 999n,
      superUser: true,
      permissions: new Map(),
    };
    next();
  }),
}));

import request from 'supertest';
import express from 'express';
import { mountRoutes, parseBody } from './helpers';

const URI = '/api/cms/housekeeping/work-orders';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
mountRoutes(app);

const list = async (qs = '') => {
  const res = await request(app).get(`${URI}${qs}`);
  expect(res.status).toBe(200);
  return parseBody(res);
};

describe('housekeeping work order list paging', () => {
  it('defaults to 25 rows instead of the whole property', async () => {
    const body = await list();
    expect(body.data.length).toBeLessThanOrEqual(25);
    expect(body.pagination.per_page).toBe(25);
  });

  it('emits a pagging block the table pager can drive', async () => {
    const body = await list();

    expect(body.pagging).toBeDefined();
    expect(body.pagging.current_page).toBe(1);
    expect(body.pagging.per_page).toBe(25);
    expect(body.pagging.total_data).toBe(body.pagination.total);
    expect(body.pagging.last_page).toBe(Math.ceil(body.pagination.total / 25));
    expect(body.pagging.end_paging).toBe(body.pagging.last_page);
    expect(body.pagging.from).toBe(1);
    expect(body.pagging.to).toBe(Math.min(25, body.pagination.total));
  });

  it('honours ?limit=', async () => {
    const body = await list('?limit=3');
    expect(body.data).toHaveLength(3);
    expect(body.pagging.per_page).toBe(3);
    expect(body.pagging.to).toBe(3);
  });

  it('caps ?limit= at 100', async () => {
    const body = await list('?limit=999');
    expect(body.pagging.per_page).toBe(100);
    expect(body.data.length).toBeLessThanOrEqual(100);
  });

  it('returns disjoint slices for page 1 and page 2', async () => {
    const p1 = await list('?limit=5');
    if (p1.pagination.total <= 5) return; // fixture too small

    const p2 = await list('?limit=5&page=2');

    expect(p1.pagging.current_page).toBe(1);
    expect(p2.pagging.current_page).toBe(2);
    expect(p2.pagging.from).toBe(6);

    const ids1 = p1.data.map((r: any) => r.id);
    const ids2 = p2.data.map((r: any) => r.id);
    expect(ids1.filter((id: number) => ids2.includes(id))).toHaveLength(0);
  });

it('walks pages without gaps or repeats', async () => {
    // limit=100 keeps this to ~11 requests instead of 105
    const first = await list('?limit=100');
    const totalData = first.pagination.total;
    if (totalData <= 100) return;

    const ids: number[] = [];
    for (let p = 1; p <= first.pagging.last_page; p++) {
      const body = await list(`?limit=100&page=${p}`);
      expect(body.pagging.current_page).toBe(p);
      expect(body.pagging.next).toBe(p < first.pagging.last_page ? p + 1 : 0);
      body.data.forEach((r: any) => ids.push(r.id));
    }
    expect(ids).toHaveLength(totalData);
    expect(new Set(ids).size).toBe(totalData);
  }, 60000);

  it('excludes soft-deleted work orders', async () => {
    const body = await list();
    const softDeleted = body.data.filter((r: any) => r.deleted_at !== null);
    expect(softDeleted).toHaveLength(0);
  });

  it('still exposes the column metadata the table renders', async () => {
    const body = await list();
    const keys = (body.table ?? []).map((c: any) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['reported_by', 'date', 'room_id', 'work_description', 'assign_to'])
    );
  });
});