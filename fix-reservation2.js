const fs = require('fs');
const content = fs.readFileSync('src/controllers/reservation.controller.ts', 'utf8');

// Find the inclusiveList method and replace it
const startMarker = 'static async inclusiveList(req: Request, res: Response): Promise<void> {';
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

const newMethod = `  // ———— GET /cms/reservation/inclusive - filter by folio's rate (Laravel parity)
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

const newContent = content.substring(0, startIdx) + newMethod + content.substring(endIdx);
fs.writeFileSync('src/controllers/reservation.controller.ts', newContent);
console.log('Fixed inclusiveList method');