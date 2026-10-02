import { formatSystemBalanceData, normalizeSystemBalanceType } from '../controllers/system.controller';

describe('system balance parity', () => {
  test('maps rows to Laravel payment payload with total row and table metadata', () => {
    const payload = formatSystemBalanceData(
      [
        { id: 7, name: 'Cash', debit: 10, credit: 0 },
        { id: 8, name: 'Visa', debit: 0, credit: 25 },
      ],
      'payment'
    );

    expect(payload.data[0]).toMatchObject({ id: 7, name: 'Cash', debit: 10, credit: 0 });
    expect(payload.data[payload.data.length - 1]).toMatchObject({ id: 0, name: '<b>Total</b>', is_total: true });
    expect(payload.table).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'name' }),
      expect.objectContaining({ key: 'debit' }),
      expect.objectContaining({ key: 'credit' }),
    ]));
    // uncapped callers get one page holding every row. `per_page` used to be a
    // 99999 sentinel, which leaked into the pager's "per page" readout and made
    // `to`/`last_page` arithmetic meaningless. last_page stays 1 either way.
    expect(payload.pagination).toMatchObject({ per_page: 2, current_page: 1, last_page: 1, total: 2, from: 1, to: 2 });
  });

  test('caps rows per page when a limit is given and keeps the Total row', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `C${i + 1}`, debit: 1, credit: 0 }));
    const p1 = formatSystemBalanceData(rows, 'payment', 10, 1);
    const p2 = formatSystemBalanceData(rows, 'payment', 10, 2);
    const last = formatSystemBalanceData(rows, 'payment', 10, 99);

    expect(p1.data).toHaveLength(11); // 10 detail + Total footer
    expect(p1.data.filter((r: any) => r.is_total)).toHaveLength(1);
    expect(p1.pagination).toMatchObject({ per_page: 10, current_page: 1, last_page: 3, total: 25, to: 10 });
    expect(p2.data[0].name).toBe('C11');
    expect(p2.pagination).toMatchObject({ current_page: 2, last_page: 3, from: 11, to: 20 });
    // page 99 clamps to the last page: 25 - 20 = 5 detail rows
    expect(last.pagination).toMatchObject({ current_page: 3, last_page: 3, from: 21, to: 25 });
    expect(last.data).toHaveLength(6);

    // the Total footer always sums the FULL set, never just the visible page
    const debit = (p: any) => p.data.find((r: any) => r.is_total).debit;
    expect(debit(p1)).toBe(debit(p2));
    expect(debit(p1)).toBe(debit(last));
  });

  test('accepts legacy camelCase frontend route aliases', () => {
    expect(normalizeSystemBalanceType('advanceDepositMovement')).toBe('deposit');
    expect(normalizeSystemBalanceType('guestLedgerMovement')).toBe('ledger');
    expect(normalizeSystemBalanceType('deposit')).toBe('deposit');
    expect(normalizeSystemBalanceType('ledger')).toBe('ledger');
  });
});
