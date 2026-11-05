process.env.APP_AES_PASSWORD = process.env.APP_AES_PASSWORD || 'lbwyBzfgzUIvXZFShJuikaWvLJhIVq36';

describe('moveReservationItems room selection', () => {
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
    return { res, raw: () => captured };
  };

  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  it('allows moving a reservation without sending a target room', async () => {
    const now = new Date('2026-01-05T00:00:00Z');
    const base = { id: 42n, property_id: 1000n, folio_id: 12n, room_id: 55n, room_type_id: 77n, rate_id: 888n, adult: 2, child: 0, add_bed: 0, status_reservation: 3, status: 1, date: new Date('2026-01-05T00:00:00Z'), eta: null, etd: null, check_in_date: new Date('2026-01-05T00:00:00Z'), check_out_date: new Date('2026-01-07T00:00:00Z') };
    const prisma = {
      reservations: {
        findUnique: jest.fn().mockResolvedValue(base),
        findFirst: jest.fn().mockResolvedValue(base),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      folios: {
        findUnique: jest.fn().mockResolvedValue({
          id: 12n,
          property_id: 1000n,
          type_reservation: 'fit',
          parent: 0n,
          check_in_date: new Date('2026-01-05T00:00:00Z'),
          check_out_date: new Date('2026-01-07T00:00:00Z'),
          room_id: 55n,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      rooms: { findFirst: jest.fn() },
      rates: { findUnique: jest.fn().mockResolvedValue({ code_post_id: 2n }) },
      rate_rates: {
        findMany: jest.fn().mockResolvedValue([{ one_adult: 100, two_adult: 150, extra_adult: 25, extra_child: 15, min_night: 1, max_night: 10, stop_sell: 0 }]),
      },
      code_posts: { findUnique: jest.fn().mockResolvedValue({ tax: false, tax_percentage: 0, local_tax: false, local_tax_percentage: 0, service_charge: false, service_charge_percentage: 0, service_charge_include_local_tax: false, tax_include_local_tax: false }) },
      properties: { findUnique: jest.fn().mockResolvedValue({ is_tax: 0 }) },
    };

    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    jest.doMock('../config/queue', () => ({ enqueueJob: jest.fn() }));
    const authMod = require('../controllers/auth.controller');
    authMod.AuthController.getBusinessDate = jest.fn().mockResolvedValue('2026-01-05');

    const { ReservationController } = require('../controllers/reservation.controller');

    const r = mkRes();
    await ReservationController.moveReservationItems(
      { params: { id: '42' }, body: { check_in_date: '2026-01-05', check_out_date: '2026-01-07' }, user: { id: 99n, lastProperty: 1000n } } as any,
      r.res as any,
    );

    console.log('raw move response', JSON.stringify(r.raw()));
    expect(r.res.__code).toBe(200);
    expect(prisma.rooms.findFirst).not.toHaveBeenCalled();
    expect(prisma.reservations.create).toHaveBeenCalled();
    expect(prisma.reservations.create.mock.calls[0][0].data.room_id).toBe(55n);
  });
});
