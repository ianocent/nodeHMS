import { formatSystemBalanceData } from '../controllers/system.controller';

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
    expect(payload.pagging).toMatchObject({ per_page: 99999, current_page: 1 });
  });
});
