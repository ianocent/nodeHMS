export function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 25, 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function parseTrash(query: any): { deleted_at: Date | null } {
  const trash = query.trash === '1' || query.trash === 'true';
  return { deleted_at: trash ? { not: null } as any : null };
}

export function parseSearch(query: any, fields: string[]): any {
  const search = (query.search as string) || '';
  if (!search) return {};
  return {
    OR: fields.map((f: string) => ({
      [f]: { contains: search, mode: 'insensitive' },
    })),
  };
}

export function parseDateRange(query: any): { start?: Date; end?: Date } {
  const start = query.start_date || query.startDate;
  const end = query.end_date || query.endDate;
  return {
    start: start ? new Date(start as string) : undefined,
    end: end ? new Date(end as string) : undefined,
  };
}

export function whereDateBetween(field: string, start?: Date, end?: Date): any {
  if (!start && !end) return {};
  const cond: any = {};
  if (start) cond.gte = start;
  if (end) cond.lte = end;
  return { [field]: cond };
}

export function parseGroup(query: any): string {
  return (query.group as string) || '';
}

export function buildWhere(query: any, extra: any = {}, searchFields: string[] = ['name']) {
  const { deleted_at } = parseTrash(query);
  const search = parseSearch(query, searchFields);
  return {
    ...extra,
    deleted_at: deleted_at as any,
    ...search,
  };
}
