// Laravel DayUseRateController@store:
//   'rate_id' => $request->rate_id
// `$request->rate_id` is a magic accessor that resolves from the query string as well as the
// body. The Rate form's "Inclusive > Day Use" tab renders a table-edit TableView whose
// queryString ("&rate_id=N") is appended to the POST URL (table-edit/index.tsx:443) while the
// body only carries the visible columns (name, time, status).
//
// The port read `payload.rate_id` - body only - so every save stored rate_id = null, and
// index()'s `where('rate_id', $rate_id)` then filtered the row it had just written out of
// view. Symptom: "Inclusive Day Use does not appear after save".

process.env.APP_AES_PASSWORD = process.env.APP_AES_PASSWORD || 'lbwyBzfgzUIvXZFShJuikaWvLJhIVq36';

describe('day use rate link from the Rate form', () => {
  const mkRes = () => {
    let captured: any = null;
    const res: any = {};
    res.status = jest.fn((c: number) => { res.__code = c; return res; });
    res.json = jest.fn((b: any) => { captured = b; return res; });
    res.send = jest.fn((b: any) => { captured = b; return res; });
    res.type = jest.fn(() => res);
    res.set = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    res.end = jest.fn(() => res);
    return { res, raw: () => JSON.parse(require('../utils/encryption').decrypt(String(captured))) };
  };

  const user = { lastProperty: 1000, superUser: true, permissions: new Map(), id: 1 } as any;
  // Exactly what table-edit sends: rate_id in the query string, absent from the body.
  const tableEditPost = (rateId: string) => ({
    query: { group: 'rate', rate_id: rateId },
    body: { name: 'Day Use 6h', time: 360, status: true },
    user,
  });

  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  it('store picks rate_id up from the query string', async () => {
    const create = jest.fn().mockResolvedValue({ id: 99n, property_id: 1000n, rate_id: 57n, name: 'Day Use 6h', time: 360, status: 1 });
    const prisma = { rate_day_uses: { create, findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
    jest.doMock('../config/prisma', () => ({ prisma, getPrisma: () => prisma, __esModule: true }));
    const { DayUseRateController } = require('../controllers/master-extra.controller');

    const r = mkRes();
    await DayUseRateController.store(tableEditPost('57') as any, r.res as any);

    expect(r.res.__code).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.rate_id).toBe(57n);
  });

  it('index then returns the row that was just saved', async () => {
    // store writes rate_id = 57; index must be able to find it again.
    const saved: any = { id: 99n, property_id: 1000n, rate_id: 57n, name: 'Day Use 6h', time: 360, status: 1, sort: 0, deleted_at: null };
    const findMany = jest.fn().mockResolvedValue([saved]);
    const prisma = { rate_day_uses: { create: jest.fn().mockResolvedValue(saved), findMany, count: jest.fn().mockResolvedValue(1), findUnique: jest.fn(), update: jest.fn() } };
    jest.doMock('../config/prisma', () => ({ prisma, getPrisma: () => prisma, __esModule: true }));
    const { DayUseRateController } = require('../controllers/master-extra.controller');

    const listRes = mkRes();
    await DayUseRateController.index({ query: { rate_id: '57', page: '1', limit: '10' }, user } as any, listRes.res as any);

    expect(listRes.res.__code).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(String(where.rate_id)).toBe('57');
    expect(listRes.raw().data).toHaveLength(1);
  });

  it('keeps standalone Day Use Rate rows unlinked when no rate is supplied', async () => {
    // The Day Use Rate master page has no rate context; those rows must stay rate_id = null.
    const create = jest.fn().mockResolvedValue({ id: 100n, property_id: 1000n, rate_id: null, name: 'Walk-in 6h', time: 360, status: 1 });
    const prisma = { rate_day_uses: { create, findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
    jest.doMock('../config/prisma', () => ({ prisma, getPrisma: () => prisma, __esModule: true }));
    const { DayUseRateController } = require('../controllers/master-extra.controller');

    const r = mkRes();
    await DayUseRateController.store({ query: {}, body: { name: 'Walk-in 6h', time: 360, status: true }, user } as any, r.res as any);

    expect(create.mock.calls[0][0].data.rate_id).toBeNull();
  });

  it('still prefers an explicit body rate_id', async () => {
    const create = jest.fn().mockResolvedValue({ id: 101n, property_id: 1000n, rate_id: 42n, name: 'X', time: 60, status: 1 });
    const prisma = { rate_day_uses: { create, findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
    jest.doMock('../config/prisma', () => ({ prisma, getPrisma: () => prisma, __esModule: true }));
    const { DayUseRateController } = require('../controllers/master-extra.controller');

    const r = mkRes();
    await DayUseRateController.store({ query: { rate_id: '57' }, body: { name: 'X', time: 60, status: true, rate_id: 42 }, user } as any, r.res as any);

    expect(create.mock.calls[0][0].data.rate_id).toBe(42n);
  });

  it('ignores a non-numeric rate_id instead of throwing', async () => {
    const create = jest.fn().mockResolvedValue({ id: 102n, property_id: 1000n, rate_id: null, name: 'Y', time: 60, status: 1 });
    const prisma = { rate_day_uses: { create, findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
    jest.doMock('../config/prisma', () => ({ prisma, getPrisma: () => prisma, __esModule: true }));
    const { DayUseRateController } = require('../controllers/master-extra.controller');

    const r = mkRes();
    await DayUseRateController.store({ query: { rate_id: 'abc' }, body: { name: 'Y', time: 60, status: true }, user } as any, r.res as any);

    expect(r.res.__code).toBe(200);
    expect(create.mock.calls[0][0].data.rate_id).toBeNull();
  });
});
