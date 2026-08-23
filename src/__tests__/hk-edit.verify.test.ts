import 'dotenv/config';
import { HousekeepingController } from '../controllers/housekeeping.controller';
import { decrypt } from '../utils/encryption';

jest.setTimeout(30000);

describe('room-status edit form', () => {
  it('returns houseKeeperHistory + hk options', async () => {
    const req: any = {
      params: { id: '676' },
      query: {},
      user: { lastProperty: 999n, bussinesDate: '2026-08-22', permissions: new Map(), superUser: true },
    };
    let statusCode = 0; let raw = '';
    const res: any = {
      status(c: number) { statusCode = c; return this; },
      type() { return this; },
      send(t: string) { raw = t; return this; },
      json(b: any) { raw = JSON.stringify(b); return this; },
    };
    await HousekeepingController.roomStatusEdit(req, res);
    console.log('STATUS', statusCode);
    expect(statusCode).toBe(200);
    let body: any;
    try { body = JSON.parse(decrypt(raw)); } catch { body = JSON.parse(raw); }
    const hkh = body?.master?.houseKeeperHistory;
    console.log('HKH', JSON.stringify(hkh));
    console.log('HK_OPTS', (body?.master?.housekeepers || []).length);
    console.log('ROOM_NAME', body?.data?.name ?? body?.name);
    expect(body?.master?.business_date).toBe('2026-08-22');
    expect(Array.isArray(body?.master?.housekeepers)).toBe(true);
  });
});
