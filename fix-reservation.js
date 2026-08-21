const fs = require('fs');
const content = fs.readFileSync('src/controllers/reservation.controller.ts', 'utf8');

// Fix inclusiveList
const oldInclusiveList = `  // ———— GET /cms/reservation/inclusive
  // ——————————————————————————————————————————————————————————————————————————————
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const modelIdRaw = String(req.query.subfolio_id ?? req.query.code_item_id ?? '');
      const where: any = { model_type: 'App\\\\Models\\\\CodeItem' };
      if (/^\\d+$/.test(modelIdRaw)) where.model_id = BigInt(modelIdRaw);
      const [data, total] = await Promise.all([
        prisma.model_has_rate_inclusives.findMany({
          where,
          include: { rate_inclusives: true },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.model_has_rate_inclusives.count({ where }),
      ]);
      const rows = data.map(d => ({ ...reservationBn(d), ...reservationBn(d.rate_inclusives) }));
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
      ];
      success(res, rows, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }`;

const newInclusiveList = `  // ———— GET /cms/reservation/inclusive - filter by folio's rate (Laravel parity)
  // ——————————————————————————————————————————————————————————————————————————————
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const folioIdRaw = String(req.query.folio_id ?? req.query.subfolio_id ?? '');
      const search = req.query.search as string;

      let where: any = { deleted_at: null };
      if (search) where.description = { contains: search, mode: 'insensitive' };

      // Get folio's rate to filter inclusives (Laravel parity)
      let rateId: bigint | null = null;
      if (folioIdRaw && /^\\d+$/.test(folioIdRaw)) {
        const folio = await prisma.folios.findUnique({
          where: { id: BigInt(folioIdRaw) },
          include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
        });
        if (folio?.reservations?.[0]?.rate_id) {
          rateId = folio.reservations[0].rate_id;
        }
      }

      if (rateId) {
        where.rate_id = rateId;
      }

      const [data, total] = await Promise.all([
        prisma.rate_inclusives.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { description: 'asc' },
        }),
        prisma.rate_inclusives.count({ where }),
      ]);
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
      ];
      success(res, data, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }`;

if (content.includes(oldInclusiveList)) {
  const newContent = content.replace(oldInclusiveList, newInclusiveList);
  fs.writeFileSync('src/controllers/reservation.controller.ts', newContent);
  console.log('Fixed inclusiveList');
} else {
  console.log('Old inclusiveList not found - trying alternative format');
  // Try with different Unicode chars
  const altOld = content.substring(content.indexOf('static async inclusiveList'), content.indexOf('  }', content.indexOf('static async inclusiveList')) + 3);
  console.log('Found alt:', altOld.substring(0, 100));
}