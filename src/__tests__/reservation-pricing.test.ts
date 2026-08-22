import { occupancyPrice, applyPromoDiscounts } from '../utils/reservationPricing';

describe('reservationPricing', () => {
  describe('occupancyPrice (Folio.php:2428-2451)', () => {
    const rr = { one_adult: 100, two_adult: 150, extra_adult: 50, extra_child: 25 };

    it('adult=1 uses one_adult only', () => {
      expect(occupancyPrice(rr, 1, 0)).toBe(100);
    });

    it('adult=2 uses two_adult (replaces one_adult)', () => {
      expect(occupancyPrice(rr, 2, 0)).toBe(150);
    });

    it('adult=4 adds two extra adults beyond second', () => {
      expect(occupancyPrice(rr, 4, 0)).toBe(150 + 2 * 50);
    });

    it('child additive on top of adult price', () => {
      expect(occupancyPrice(rr, 2, 3)).toBe(150 + 3 * 25);
    });
  });

  describe('applyPromoDiscounts (CodePost.php:68-76/135-143)', () => {
    it('percentage promo reduces amount proportionally', () => {
      expect(applyPromoDiscounts(200, [{ promotion_type: 'percentage', discount_percentage: 10, discount_flat: null }])).toBeCloseTo(180);
    });

    it('flat promo subtracts fixed amount', () => {
      expect(applyPromoDiscounts(200, [{ promotion_type: 'flat', discount_percentage: null, discount_flat: 50 }])).toBe(150);
    });

    it('multiple promos stack sequentially', () => {
      const promos = [
        { promotion_type: 'percentage', discount_percentage: 10, discount_flat: null },
        { promotion_type: 'flat', discount_percentage: null, discount_flat: 20 },
      ];
      expect(applyPromoDiscounts(100, promos)).toBeCloseTo(70);
    });

    it('empty promos leave amount unchanged', () => {
      expect(applyPromoDiscounts(100, [])).toBe(100);
    });
  });
});
