import type { Response } from 'express';

/**
 * Laravel `unique_extend` parity.
 *
 * The reference declares e.g.
 *   'name' => ['required','string','max:255','unique_extend:code_billings,name,NULL,id,deleted_at,NULL']
 *   'name' => ['required','string','max:255','unique_extend:code_billings,name,'.$id.',id,deleted_at,NULL']
 *
 * Semantics:
 *   - soft-delete aware: rows with `deleted_at` set are ignored
 *   - `NULL` as the exclude id means "creating" (nothing to exclude)
 *   - an id means "updating" (exclude that row so saving without changes passes)
 *   - `max:255` is enforced by the column length, so only uniqueness is checked here
 *
 * Laravel returns the field name in the error payload, so callers pass `field`
 * separately from the table.
 */
export async function assertUniqueExtend(
  prisma: any,
  table: string,
  column: string,
  value: unknown,
  excludeId?: bigint | number | null,
  extraWhere: Record<string, any> = {}
): Promise<bigint | null> {
  if (value === null || value === undefined) return null;
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === '') return null;

  const where: any = {
    ...extraWhere,
    [column]: v,
    deleted_at: null,
  };
  if (excludeId !== null && excludeId !== undefined) {
    where.id = { not: BigInt(excludeId) };
  }
  const hit = await prisma[table].findFirst({ where, select: { id: true } });
  return hit?.id ?? null;
}

/** Returns true when the value collides with another (non-deleted) row. */
export async function isDuplicate(
  prisma: any,
  table: string,
  column: string,
  value: unknown,
  excludeId?: bigint | number | null,
  extraWhere: Record<string, any> = {}
): Promise<boolean> {
  const id = await assertUniqueExtend(prisma, table, column, value, excludeId, extraWhere);
  return id !== null;
}

/**
 * Resolves to an error message when the value is taken, otherwise null. Keeps the
 * repeated `if (dup) { badRequest(...) ; return; }` blocks in the controllers short.
 */
export async function uniqueExtendError(
  prisma: any,
  table: string,
  column: string,
  label: string,
  value: unknown,
  excludeId?: bigint | number | null,
  extraWhere: Record<string, any> = {}
): Promise<string | null> {
  const dup = await isDuplicate(prisma, table, column, value, excludeId, extraWhere);
  return dup ? `The ${label} has already been taken.` : null;
}

/** Convenience for the common `errors.<field>` + validationError(422) flow. */
export async function collectUniqueErrors(
  prisma: any,
  checks: Array<{
    table: string;
    column: string;
    label: string;
    value: unknown;
    excludeId?: bigint | number | null;
    extraWhere?: Record<string, any>;
  }>,
  errors: Record<string, string[]>
): Promise<boolean> {
  let added = false;
  for (const c of checks) {
    const msg = await uniqueExtendError(
      prisma,
      c.table,
      c.column,
      c.label,
      c.value,
      c.excludeId,
      c.extraWhere ?? {}
    );
    if (msg) {
      errors[c.column] = [msg];
      added = true;
    }
  }
  return added;
}
