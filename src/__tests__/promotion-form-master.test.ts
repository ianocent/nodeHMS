// Laravel PromotionController@create/edit return `master` through ->additional(), which puts
// it as a SIBLING of `data`:
//   create: additional(['master' => ['statuses' => $status, 'code' => CurrentgeneratePromotionCode()]])
//   edit:   additional(['master' => ['statuses' => $status]])
//
// The port sent that object as `data` and renamed `code` to `promotion_code`, and on edit it
// spread master INTO data. The form reads `datauser.master.code` and `datauser.master.*`, so
// the Promotion Code input was blank on Add and every master option read was undefined on Edit.

process.env.APP_AES_PASSWORD = process.env.APP_AES_PASSWORD || 'lbwyBzfgzUIvXZFShJuikaWvLJhIVq36';

describe('promotion create/edit master shape', () => {
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

  const user = { lastProperty: 1000, superUser: true, permissions: new Map() } as any;

  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  it('create returns master.code as a sibling of data', async () => {
    const prisma = { promotions: { findFirst: jest.fn().mockResolvedValue(null) } };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { PromotionController } = require('../controllers/promotion.controller');

    const r = mkRes();
    await PromotionController.create({ user } as any, r.res as any);
    const body = r.raw();

    expect(r.res.__code).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.master).toBeDefined();
    expect(typeof body.master.code).toBe('string');
    expect(body.master.code).toHaveLength(8);
    expect(Array.isArray(body.master.statuses)).toBe(true);
    // The form reads master.code; the old `data.promotion_code` key is what broke it.
    expect(body.data?.promotion_code).toBeUndefined();
  });

  it('create retries when the generated code is already taken', async () => {
    const findFirst = jest.fn()
      .mockResolvedValueOnce({ id: 5 })     // first draw collides
      .mockResolvedValueOnce({ id: 6 })     // second draw collides
      .mockResolvedValueOnce(null);         // third draw is free
    const prisma = { promotions: { findFirst } };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { PromotionController } = require('../controllers/promotion.controller');

    const r = mkRes();
    await PromotionController.create({ user } as any, r.res as any);
    const body = r.raw();

    expect(findFirst).toHaveBeenCalledTimes(3);
    expect(body.master.code).toHaveLength(8);
  });

  it('edit returns master as a sibling, not nested inside data', async () => {
    const promotion = {
      id: 2n, property_id: 1000n, promotion_type: 'amount', promotion_code: 'hutri80',
      description: 'discount hut ri 80', status: 1, sort: 0, deleted_at: null,
    };
    const prisma = { promotions: { findUnique: jest.fn().mockResolvedValue(promotion) } };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { PromotionController } = require('../controllers/promotion.controller');

    const r = mkRes();
    await PromotionController.edit({ params: { id: '2' }, user } as any, r.res as any);
    const body = r.raw();

    expect(r.res.__code).toBe(200);
    // Sibling, so the form's `datauser.master.statuses` read resolves.
    expect(body.master).toBeDefined();
    expect(Array.isArray(body.master.statuses)).toBe(true);
    // Must NOT be nested inside data any more.
    expect(body.data.master).toBeUndefined();
    expect(body.data.promotion_code).toBe('hutri80');
  });
});
