process.env.APP_AES_PASSWORD = process.env.APP_AES_PASSWORD || 'lbwyBzfgzUIvXZFShJuikaWvLJhIVq36';

describe('cancel reservation reason normalization', () => {
  const mkRes = () => {
    const res: any = {};
    res.status = jest.fn((c: number) => { res.__code = c; return res; });
    res.json = jest.fn((b: any) => { res.__body = b; return res; });
    res.send = jest.fn((b: any) => { res.__body = b; return res; });
    res.type = jest.fn(() => res);
    res.set = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    res.end = jest.fn(() => res);
    return res;
  };

  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  it('stores the selected cancellation reason value in bulk cancel payloads', async () => {
    const prisma = {
      folios: {
        findUnique: jest.fn().mockResolvedValue({
          id: 12n,
          folio_number: 'F-100',
          status_reservation: 3,
          type_reservation: 'fit',
          parent: 0n,
          data: '{}',
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      reservations: {
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };

    jest.doMock('../config/prisma', () => ({ prisma, __esModule: true }));
    jest.doMock('../config/queue', () => ({ enqueueJob: jest.fn() }));
    jest.doMock('../utils/audit', () => ({ writeAudit: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('../controllers/auth.controller', () => ({
      AuthController: { getBusinessDate: jest.fn().mockResolvedValue('2026-01-05') },
    }));
    jest.doMock('../controllers/front-desk.controller', () => ({
      folioBalanceMinorUnits: jest.fn().mockResolvedValue(0),
      isFolioSettledMinorPublic: jest.fn(() => true),
      performCheckIn: jest.fn(),
      performCheckOut: jest.fn(),
      performReverseStay: jest.fn(),
      performChangeStayDate: jest.fn(),
      transferTransactionsForCheckout: jest.fn(),
    }));

    const { ReservationController } = require('../controllers/reservation.controller');
    const res = mkRes();

    await ReservationController.updateBulk(
      { body: { status_reservation: 'cancel_reservation', folio_ids: [12], remark: 'weather', reason: { value: 'change of plans', label: 'Change of plans' } }, user: { id: 99n, lastProperty: 1000n } } as any,
      res as any,
    );

    expect(res.__code).toBe(200);
    expect(prisma.folios.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 12n },
      data: expect.objectContaining({
        data: expect.stringContaining('"reason_cancel_reservation":"change of plans"'),
      }),
    }));
  });
});
