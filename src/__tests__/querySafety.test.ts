import {
  activeWhere,
  applyStatusScope,
  buildSearchWhere,
  coerceValue,
  hasField,
  modelExists,
  safeOrderBy,
  searchPredicate,
} from '../utils/querySafety';

describe('querySafety schema awareness', () => {
  it('resolves models and scalar fields from the DMMF', () => {
    expect(modelExists('rooms')).toBe(true);
    expect(modelExists('not_a_table')).toBe(false);
    expect(hasField('rooms', 'name')).toBe(true);
    expect(hasField('rooms', 'name_html')).toBe(false);
    expect(hasField('rooms', 'room_status_color')).toBe(false);
  });

  it('coerces query-string values to the column scalar type', () => {
    expect(coerceValue('Int', '12')).toBe(12);
    expect(coerceValue('BigInt', '12')).toBe(12);
    expect(coerceValue('Int', 'abc')).toBeUndefined();
    expect(coerceValue('Boolean', 'true')).toBe(true);
    expect(coerceValue('Boolean', '1')).toBe(true);
    expect(coerceValue('Boolean', '0')).toBe(false);
    expect(coerceValue('String', 5)).toBe('5');
    expect(coerceValue('DateTime', '2024-01-01')).toBeInstanceOf(Date);
    expect(coerceValue('DateTime', 'not-a-date')).toBeUndefined();
  });

  it('drops virtual columns instead of sending contains to Prisma', () => {
    expect(searchPredicate('rooms', 'name_html', 'x')).toBeUndefined();
    expect(searchPredicate('rooms', 'room_status_color', 'x')).toBeUndefined();
    expect(searchPredicate('rooms', 'name', 'x')).toEqual({ name: { contains: 'x', mode: 'insensitive' } });
  });

  it('matches non-string scalars exactly', () => {
    expect(searchPredicate('rooms', 'total_bed', '4')).toEqual({ total_bed: { equals: 4 } });
    expect(searchPredicate('code_billings', 'status', '1')).toEqual({ status: { equals: 1 } });
    expect(searchPredicate('countries', 'status', '1')).toEqual({ status: { equals: true } });
    expect(searchPredicate('guest_profiles', 'status', '0')).toEqual({ status: { equals: 0 } });
    expect(searchPredicate('guest_profile_family_members', 'relationship', 'spouse')).toEqual({
      relationship: { contains: 'spouse', mode: 'insensitive' },
    });
  });

  it('skips the Laravel -1 / undefined / empty sentinels', () => {
    expect(searchPredicate('code_billings', 'status', '-1')).toBeUndefined();
    expect(searchPredicate('code_billings', 'status', '')).toBeUndefined();
    expect(searchPredicate('code_billings', 'status', 'undefined')).toBeUndefined();
  });

  it('drops non-searchable values that cannot be coerced', () => {
    expect(searchPredicate('rates', 'start_date', 'tomorrow')).toBeUndefined();
  });

  it('ANDs multi-field search and coerces each column', () => {
    // code_posts has no `code` column (Laravel uses `name`), and no
    // `code_gl_description` — both are dropped instead of crashing Prisma.
    const req = { query: { search_field: 'code;status;', search_value: 'TAX;1;' } };
    expect(buildSearchWhere(req, { model: 'code_posts' })).toEqual({
      AND: [{ status: { equals: 1 } }],
    });

    const named = { query: { search_field: 'name;status', search_value: 'TAX;1' } };
    expect(buildSearchWhere(named, { model: 'code_posts' })).toEqual({
      AND: [{ name: { contains: 'TAX', mode: 'insensitive' } }, { status: { equals: 1 } }],
    });
  });

  it('supports Laravel sort() parity: -column, column, unknown column', () => {
    expect(safeOrderBy('rooms', '-name')).toEqual({ name: 'desc' });
    expect(safeOrderBy('rooms', 'name')).toEqual({ name: 'asc' });
    expect(safeOrderBy('rooms', '-name_html', { id: 'asc' })).toEqual({ id: 'asc' });
    expect(safeOrderBy('rooms', '')).toEqual({});
    expect(safeOrderBy('rooms', '-1')).toEqual({});
  });

  it('activeWhere mirrors SoftDeletes + HasProperties + onlyActive', () => {
    // use plain numbers so a failing diff cannot break jest's BigInt serializer
    const pid = 7 as unknown as bigint;
    expect(activeWhere('code_billings', {}, pid)).toEqual({
      deleted_at: null,
      property_id: 7,
      status: 1,
    });
    // explicit filters win over the defaults
    expect(activeWhere('code_billings', { status: 0, property_id: 9, deleted_at: { not: null } }, pid)).toEqual({
      deleted_at: { not: null },
      property_id: 9,
      status: 0,
    });
    // models without those columns are untouched
    expect(activeWhere('countries')).toEqual({ status: true });
    expect(activeWhere('rates')).toEqual({ deleted_at: null, status: 1 });
  });

  it('applyStatusScope follows the Laravel HasStatus whitelist', () => {
    const where: any = { deleted_at: null };
    applyStatusScope(where, { method: 'GET', query: { group: 'code-billing' } }, 'code_billings');
    expect(where.status).toBe(1);

    // no `group` -> scope does not fire (non table-list request)
    const noGroup: any = {};
    applyStatusScope(noGroup, { method: 'GET', query: {} }, 'code_billings');
    expect(noGroup.status).toBeUndefined();

    // explicit status filter -> scope skipped
    const searched: any = {};
    applyStatusScope(searched, { method: 'GET', query: { group: 'code-billing', search_field: 'status' } }, 'code_billings');
    expect(searched.status).toBeUndefined();

    // non whitelisted table
    const other: any = {};
    applyStatusScope(other, { method: 'GET', query: { group: 'folio' } }, 'folios');
    expect(other.status).toBeUndefined();

    // Boolean status column
    const country: any = {};
    applyStatusScope(country, { method: 'GET', query: { group: 'country' } }, 'countries');
    expect(country.status).toBe(true);

    // non-GET request
    const post: any = {};
    applyStatusScope(post, { method: 'POST', query: { group: 'code-billing' } }, 'code_billings');
    expect(post.status).toBeUndefined();
  });
});