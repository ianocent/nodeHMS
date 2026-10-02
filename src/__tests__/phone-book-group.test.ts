// The response helper chain reads APP_AES_PASSWORD at import time and jest does not load .env.
process.env.APP_AES_PASSWORD = process.env.APP_AES_PASSWORD || 'lbwyBzfgzUIvXZFShJuikaWvLJhIVq36';


// Root cause of "Phone Group 1 cannot add": phoneBookGroupList filters `group = N`
// (Laravel: PhoneBookGroup{N}::where('group', N)) but phoneBookGroupStore never wrote
// `group`, so every new row fell to the schema default 0 and stayed invisible in all
// three tabs. The store routes also had to carry the level, otherwise the controller
// cannot know whether the caller is on tab 1, 2 or 3.

describe('phone book group level pinning', () => {
    const ok = () => {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.send = jest.fn(() => res);
    res.type = jest.fn(() => res);
    res.set = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    res.end = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('store writes the level that the route passed through', async () => {
    const prisma = {
      phone_book_groups: { create: jest.fn().mockResolvedValue({ id: 1 }), update: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { ConciergeController } = require('../controllers/concierge.controller');

    for (const level of [1, 2, 3]) {
      prisma.phone_book_groups.create.mockClear();
      const res = ok();
      await ConciergeController.phoneBookGroupStore({
        body: { name: `group-${level}` },
        params: { groupLevel: String(level) },
        user: { lastProperty: 999, id: 1 },
      } as any, res);

      const payload = prisma.phone_book_groups.create.mock.calls[0][0].data;
      expect(payload.group).toBe(level);
      expect(payload.name).toBe(`group-${level}`);
    }
  });

  it('store defaults to level 1 when no level is supplied', async () => {
    const prisma = {
      phone_book_groups: { create: jest.fn().mockResolvedValue({ id: 1 }), update: jest.fn() },
    };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { ConciergeController } = require('../controllers/concierge.controller');

    await ConciergeController.phoneBookGroupStore({ body: { name: 'legacy' }, params: {}, user: { lastProperty: 999 } } as any, ok());
    expect(prisma.phone_book_groups.create.mock.calls[0][0].data.group).toBe(1);
  });

  it('update keeps the row pinned to its level', async () => {
    const prisma = {
      phone_book_groups: { create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { ConciergeController } = require('../controllers/concierge.controller');

    await ConciergeController.phoneBookGroupUpdate({
      body: { name: 'renamed', sort: 1, status: 1 },
      params: { id: '55', groupLevel: '3' },
      user: { lastProperty: 999 },
    } as any, ok());

    expect(prisma.phone_book_groups.update.mock.calls[0][0].data.group).toBe(3);
  });

  it('list scopes by the same level the store pinned', async () => {
    const prisma = {
      phone_book_groups: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    const { ConciergeController } = require('../controllers/concierge.controller');

    for (const level of [1, 2, 3]) {
      prisma.phone_book_groups.findMany.mockClear();
      await ConciergeController.phoneBookGroupList({
        query: {}, params: { groupLevel: String(level) }, user: { lastProperty: 999 },
      } as any, ok());

      // A row only shows up when store.group === list.where.group.
      expect(prisma.phone_book_groups.findMany.mock.calls[0][0].where.group).toBe(level);
    }
  });
});
