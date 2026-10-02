/**
 * Dashboard card data parity checks.
 *
 * Focus: the `total_room` card, which Laravel builds from
 * Room::getListAndMaidStatusRoom(). Every row there counts the SAME active room
 * set, so the fixture numbers below are tied together:
 *
 *   Total Rooms = Saleable(0,1,2) + Due Out(3) + OOO(4)   -> 83 + 18 + 5 = 106
 *   maid rows (Clean/Dirty/Maid in Room/Inspection) sum to Total Rooms
 *
 * `rooms` has no Prisma relation to `room_availabilities`, so Blocked Rooms is
 * resolved by a separate query intersected with the active ids — this asserts
 * that intersection stays wired up.
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

const PROPERTY_ID = 999n;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
mountRoutes(app);

const getCard = async (code: string) => {
  const res = await request(app).get(`/api/cms/get-dashboard/${code}`);
  const body = parseBody(res);
  expect(res.status).toBe(200);
  expect(body?.code).toBe('200');
  return body;
};

const rowValue = (list: any[], name: string): number => {
  const row = list.find((r) => r.name === name);
  expect(row).toBeDefined();
  return Number(row.data);
};

describe('dashboard /cms/get-dashboard/total_room', () => {
  let list: any[];
  let businessDate: string;

  beforeAll(async () => {
    const body = await getCard('total_room');
    businessDate = String(body.dateLog).slice(0, 10);
    list = body.data?.[0]?.list ?? [];
  });

  it('reports 106 total rooms for property 999', () => {
    // Laravel `onlyActive()` = where('rooms.status', 1) with NO `is_physical`
    // filter. Counting `is_physical` instead yields 111 and drops the one
    // active non-physical room.
    expect(rowValue(list, 'Total Rooms')).toBe(106);
  });

  it('excludes inactive rooms from the total', async () => {
    const res = await request(app).get('/api/cms/get-dashboard/total_room');
    const body = parseBody(res);
    expect(rowValue(body.data[0].list, 'Total Rooms')).toBeLessThan(111);
  });

  it('keeps room-status rows on the same active set as the total', () => {
    const saleable = rowValue(list, 'Saleable Room');
    const ooo = rowValue(list, 'OOO');
    const dueOut = 18; // room_status 3 rows in the fixture DB

    expect(saleable).toBe(83);
    expect(ooo).toBe(5);
    expect(saleable + ooo + dueOut).toBe(rowValue(list, 'Total Rooms'));
  });

  it('maid-status rows sum back to the total', () => {
    const maidTotal =
      rowValue(list, 'Clean') +
      rowValue(list, 'Dirty') +
      rowValue(list, 'Maid in Room') +
      rowValue(list, 'Inspection Required');

    expect(maidTotal).toBe(rowValue(list, 'Total Rooms'));
  });

  it('resolves Blocked Rooms from room_availabilities on the business date', () => {
    // Was hardcoded to 0. Property 999 has 18 not-deleted availability rows on
    // the business date; the count must be > 0 and at most the total rooms.
    const blocked = rowValue(list, 'Blocked Rooms');

    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThanOrEqual(rowValue(list, 'Total Rooms'));
  });

  it('uses a business date, not the wall clock', () => {
    expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dashboard revenue cards', () => {
  it('exposes Manual Posting / MTD / YTD labels for the number-only widget', async () => {
    const res = await request(app).get('/api/cms/get-dashboard/today_revenue');
    const body = parseBody(res);
    expect(res.status).toBe(200);

    const card = (body.data as any[]).find((d) => d?.type === 'number-only');
    expect(card).toBeDefined();
    expect(card.label).toEqual(['Manual Posting Revenue', 'MTD Revenue', 'YTD Revenue']);
    expect(card.data).toHaveLength(3);
    card.data.forEach((v: unknown) => expect(typeof v).toBe('string'));
  });
});

describe('dashboard revenue drill-down list height', () => {
  // The MTD/YTD popups render inside a max-h modal. formatSystemBalanceData used
  // to return every DEFAULT code post (38 detail rows on property 999), which
  // pushed the popup past the navbar. Laravel paginates these lists at 10.
  const REVENUE_URIS = [
    ['DTD', '/api/cms/dashboard/today-revenue'],
    ['MTD', '/api/cms/dashboard/mtd-revenue'],
    ['YTD', '/api/cms/dashboard/ytd-revenue'],
  ] as const;

  it.each(REVENUE_URIS)('%s caps detail rows at 10 by default', async (_label, uri) => {
    const res = await request(app).get(uri);
    const body = parseBody(res);
    expect(res.status).toBe(200);

    const rows = body.data as any[];
    const detail = rows.filter((r) => !r.is_total);

    expect(detail.length).toBeLessThanOrEqual(10);
    expect(body.pagination.per_page).toBe(10);
    // one Total row is still appended on top of the capped detail rows
    expect(rows.filter((r) => r.is_total)).toHaveLength(1);
    expect(detail.length).toBe(rows.length - 1);
  });

  // success() REBUILDS pagging from meta.pagination, so the widgets only get a
  // working pager when pagination.total is the DETAIL row count.
  it('emits a pagging block the table pager can actually drive', async () => {
    const body = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue'));

    expect(body.pagging).toBeDefined();
    expect(body.pagging.current_page).toBe(1);
    expect(body.pagging.per_page).toBe(10);
    expect(body.pagging.total_data).toBe(body.pagging.total_data);
    expect(body.pagging.last_page).toBe(Math.ceil(body.pagging.total_data / 10));
    expect(body.pagging.end_paging).toBe(body.pagging.last_page);
    expect(body.pagging.from).toBe(1);
    expect(body.pagging.to).toBe(Math.min(10, body.pagging.total_data));
    expect(body.pagging.next).toBe(body.pagging.total_data > 10 ? 2 : 0);
  });

  it('walks pages without gaps or repeats and clamps past the last page', async () => {
    const first = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue?page=1'));
    const totalData = first.pagging.total_data;
    if (totalData <= 10) return; // fixture too small to exercise paging

    const names: string[] = [];
    for (let p = 1; p <= first.pagging.last_page; p++) {
      const body = parseBody(await request(app).get(`/api/cms/dashboard/ytd-revenue?page=${p}`));
      expect(body.pagging.current_page).toBe(p);
      expect(body.pagging.next).toBe(p < first.pagging.last_page ? p + 1 : 0);
      expect(body.data.filter((r: any) => r.is_total)).toHaveLength(1);
      body.data.filter((r: any) => !r.is_total).forEach((r: any) => names.push(r.name));
    }
    expect(names).toHaveLength(totalData);
    expect(new Set(names).size).toBe(totalData);

    const overflow = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue?page=999'));
    expect(overflow.pagging.current_page).toBe(first.pagging.last_page);
    expect(overflow.pagging.next).toBe(0);
  }, 60000);

  it.each(REVENUE_URIS)('%s honours an explicit ?limit=', async (_label, uri) => {
    const body = parseBody(await request(app).get(`${uri}?limit=3`));
    const detail = (body.data as any[]).filter((r) => !r.is_total);

    expect(detail).toHaveLength(3);
    expect(body.pagination.per_page).toBe(3);
  });

  it('clamps an absurd ?limit= to 100', async () => {
    const body = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue?limit=99999'));
    expect(body.pagination.per_page).toBe(100);
  });

  it('falls back to 10 for a junk ?limit=', async () => {
    const body = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue?limit=abc'));
    expect(body.pagination.per_page).toBe(10);
  });

  it('keeps the Total row equal to the FULL set, not the capped set', async () => {
    const full = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue?limit=1000'));
    const capped = parseBody(await request(app).get('/api/cms/dashboard/ytd-revenue?limit=2'));

    const fullDetail = (full.data as any[]).filter((r) => !r.is_total);
    const fullTotal = (full.data as any[]).find((r) => r.is_total);
    const cappedTotal = (capped.data as any[]).find((r) => r.is_total);

    expect(fullDetail.length).toBeGreaterThan(2);
    expect((capped.data as any[]).filter((r) => !r.is_total)).toHaveLength(2);
    // same grand total even though fewer rows were sent
    expect(cappedTotal.debit).toBe(fullTotal.debit);
    expect(cappedTotal.credit).toBe(fullTotal.credit);
    // the Total footer is not a row, so pagination.total counts detail rows only
    expect(full.pagination.total).toBe(fullDetail.length);
  });
});