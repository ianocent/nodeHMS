const fs = require('fs');
const content = fs.readFileSync('src/controllers/reservation.controller.ts', 'utf8');

// Find the codeItemList method and replace it
const startMarker = 'static async codeItemList(req: Request, res: Response): Promise<void> {';
const startIdx = content.indexOf(startMarker);
if (startIdx === -1) {
  console.log('Method not found');
  process.exit(1);
}

// Find the end of the method (next method or class end)
let braceCount = 0;
let endIdx = startIdx;
let inMethod = false;
for (let i = startIdx; i < content.length; i++) {
  if (content[i] === '{') {
    braceCount++;
    inMethod = true;
  } else if (content[i] === '}') {
    braceCount--;
    if (inMethod && braceCount === 0) {
      endIdx = i + 1;
      break;
    }
  }
}

if (endIdx === startIdx) {
  console.log('Could not find end of method');
  process.exit(1);
}

const oldMethod = content.substring(startIdx, endIdx);
console.log('Found method, length:', oldMethod.length);

const newMethod = `  // GET /cms/reservation/code-item (additional item page)
  // ———— GET /cms/reservation/code-item (additional item page) - filter by folio's rate
  // ——————————————————————————————————————————————————————————————————————————————
  static async codeItemList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const folioIdRaw = String(req.query.folio_id ?? '');

      let where: any = { deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      // Get folio's rate to filter code items (Laravel parity via model_has_code_items)
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

      // Filter code_items by rate via model_has_code_items (Laravel parity)
      if (rateId) {
        const codeItemIds = await prisma.$queryRaw<{ code_item_id: bigint }[]>\\`
          SELECT DISTINCT code_item_id
          FROM model_has_code_items
          WHERE model_type = 'App\\\\Models\\\\Rate'
            AND model_id = \${rateId}
            AND code_item_id IS NOT NULL
        \`;
        const ids = codeItemIds.map((r) => r.code_item_id);
        if (ids.length > 0) {
          where.id = { in: ids };
        } else {
          // No code items linked to this rate
          where.id = -1;
        }
      }

      const [data, total] = await Promise.all([
        prisma.code_items.findMany({
          where,
          include: { code_posts: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.code_items.count({ where }),
      ]);
      const table = [
        { label: 'Code', key: 'code', type: 'none', is_search: false },
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Sales', key: 'sales', type: 'number', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
      ];
      success(res, reservationBn(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Code item list error:', err); error(res, 'Failed to list code items', 500); }
  }`;

const newContent = content.substring(0, startIdx) + newMethod + content.substring(endIdx);
fs.writeFileSync('src/controllers/reservation.controller.ts', newContent);
console.log('Fixed codeItemList method');