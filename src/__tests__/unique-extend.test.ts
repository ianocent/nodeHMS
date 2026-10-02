// Laravel unique_extend parity: the master-data stores declared
//   'name' => [... 'unique_extend:<table>,name,<excludeId|ignored>,id,deleted_at,NULL']
// but the node port only had the `required` checks, so duplicate names could be
// created. These tests pin the behaviour that was missing:
//   - creating a name that already exists in the same property is rejected
//   - the same name in a DIFFERENT property is allowed (multi-tenant)
//   - a soft-deleted row does not block reuse of its name
//   - updating a row with its own unchanged name is allowed
//   - updating a row onto another row's name is rejected

jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = {
      id: 1n,
      name: 'Test Admin',
      username: 'admin',
      email: 'admin@test.com',
      roles: ['administrator'],
      roleIds: [1n],
      lastProperty: 999n,
      superUser: true,
      permissions: new Map(),
    };
    next();
  }),
}));

jest.mock('../middleware/permission.middleware', () => ({
  requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  getPermissionFlags: jest.fn(() => ({ view: true, add: true, edit: true, delete: true })),
}));

import request from 'supertest';
import express from 'express';
import { mountRoutes, parseBody } from './helpers';

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  mountRoutes(app);
});

const { prisma } = require('../config/prisma');

const stamp = Date.now();
const base = `DUP-${stamp}`;

async function hardDeleteBilling(id?: number) {
  if (!id) return;
  await prisma.code_billings.delete({ where: { id: BigInt(id) } }).catch(() => undefined);
}

async function hardDeleteCompany(id?: number) {
  if (!id) return;
  await prisma.company_profiles.delete({ where: { id: BigInt(id) } }).catch(() => undefined);
}

async function createBilling(name: string, propertyId: number) {
  const res = await request(app)
    .post('/api/cms/code-billings')
    .send({ name, status: 1, description: `${name}-desc` });
  expect(res.status).toBe(200);
  return Number(parseBody(res)?.data?.id);
}

describe('unique_extend parity — code_billings.name', () => {
  let created: number | undefined;

  afterAll(async () => {
    await hardDeleteBilling(created);
  });

  it('creates the first row', async () => {
    const res = await request(app)
      .post('/api/cms/code-billings')
      .send({ name: base, status: 1, description: `${base}-desc` });
    expect(res.status).toBe(200);
    created = Number(parseBody(res)?.data?.id);
    expect(created).toBeDefined();
  });

  it('rejects a duplicate name in the same property', async () => {
    const res = await request(app)
      .post('/api/cms/code-billings')
      .send({ name: base, status: 1, description: 'other' });
    expect(res.status).toBe(400);
    expect(parseBody(res).message).toMatch(/already been taken/i);
  });

  it('rejects renaming an update onto another row name', async () => {
    const other = await createBilling(`${base}-B`, 999);
    try {
      const res = await request(app).put(`/api/cms/code-billings/${other}`).send({ name: base });
      expect(res.status).toBe(400);
      expect(parseBody(res).message).toMatch(/already been taken/i);
    } finally {
      await hardDeleteBilling(other);
    }
  });

  it('allows an update that keeps the row own name', async () => {
    const res = await request(app)
      .put(`/api/cms/code-billings/${created}`)
      .send({ name: base, description: 'touched' });
    expect(res.status).toBe(200);
  });

  it('allows reusing a soft-deleted name', async () => {
    const tmp = await createBilling(`${base}-DEL`, 999);
    const del = await request(app).delete(`/api/cms/code-billings/${tmp}`);
    expect(del.status).toBe(200);

    const res = await request(app)
      .post('/api/cms/code-billings')
      .send({ name: `${base}-DEL`, status: 1, description: 'recreated' });
    expect(res.status).toBe(200);
    await hardDeleteBilling(Number(parseBody(res)?.data?.id));
  });

  it('allows the same name under a different property', async () => {
    // code_billings is multi-tenant: this dataset has 7 name groups duplicated
    // globally (each property keeps its own PAYMENT / ROOM REVENUE rows) while having
    // zero duplicates inside a property. A literal global check would reject this.
    // Seed the other property directly so the test does not depend on which property
    // the endpoint happens to target, then POST (which lands on the mocked 999).
    const other = await prisma.properties.findFirst({
      where: { id: { not: 999n } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(other).toBeDefined();

    const crossName = `DUP-CROSS-${stamp}`;
    const seeded = await prisma.code_billings.create({
      data: {
        property_id: other!.id,
        name: crossName,
        description: 'seeded on another property',
        isPOS: 0,
        sort: 0,
        status: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    const res = await request(app)
      .post('/api/cms/code-billings')
      .send({ name: crossName, status: 1, description: 'created on 999' });
    expect(res.status).toBe(200);
    const secondId = Number(parseBody(res)?.data?.id);

    const rows = await prisma.code_billings.findMany({
      where: { name: crossName, deleted_at: null },
      select: { id: true, property_id: true },
    });
    expect(rows.length).toBe(2);
    expect(String(rows[0].property_id)).not.toBe(String(rows[1].property_id));

    await prisma.code_billings.delete({ where: { id: seeded.id } }).catch(() => undefined);
    await hardDeleteBilling(secondId);
  });
});

describe('unique_extend parity — room units (rooms.name / address_code)', () => {
  const stamp = Date.now();
  let roomTypeId: bigint;
  const createdIds: number[] = [];

  const createRoom = async (name: string, addressCode?: string) => {
    const res = await request(app)
      .post('/api/cms/rooms')
      .send({
        room_type_id: String(roomTypeId),
        name,
        max_pax: 2,
        total_bed: 1,
        with_tv: 1,
        with_shower: 1,
        status: 1,
        ...(addressCode ? { address_code: addressCode } : {}),
      });
    return res;
  };

  beforeAll(async () => {
    const rt = await prisma.room_types.findFirst({
      where: { deleted_at: null, status: 1, property_id: 999n },
      select: { id: true },
    });
    roomTypeId = rt!.id;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.rooms.delete({ where: { id: BigInt(id) } }).catch(() => undefined);
    }
  });

  it('creates a first room unit', async () => {
    const res = await createRoom(`DUPR-${stamp}`);
    expect(res.status).toBe(200);
    createdIds.push(Number(parseBody(res)?.data?.id));
  });

  it('rejects a duplicate room name in the same property', async () => {
    const res = await createRoom(`DUPR-${stamp}`);
    // RoomController.store reports through validationError(), i.e. 422 like Laravel.
    expect(res.status).toBe(422);
    expect(JSON.stringify(parseBody(res))).toMatch(/already been taken/i);
  });

  it('rejects a duplicate address_code in the same property', async () => {
    const code = `AC-${stamp}`;
    const first = await createRoom(`DUPR-${stamp}-A`, code);
    expect(first.status).toBe(200);
    createdIds.push(Number(parseBody(first)?.data?.id));

    const res = await createRoom(`DUPR-${stamp}-B`, code);
    expect(res.status).toBe(422);
    expect(JSON.stringify(parseBody(res))).toMatch(/address code has already been taken/i);
  });

  it('allows the same room name under a different property', async () => {
    // 392 active rooms, 0 within-property duplicate names, 98 duplicated across
    // properties - so a literal global check would reject valid rows.
    const other = await prisma.properties.findFirst({
      where: { id: { not: 999n } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(other).toBeDefined();

    const crossName = `DUPR-CROSS-${stamp}`;
    const seeded = await prisma.rooms.create({
      data: {
        property_id: other!.id,
        room_type_id: roomTypeId,
        name: crossName,
        max_pax: 2,
        total_bed: 1,
        is_physical: true,
        room_status: 1,
        maid_status: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    const res = await createRoom(crossName);
    expect(res.status).toBe(200);
    createdIds.push(Number(parseBody(res)?.data?.id));

    await prisma.rooms.delete({ where: { id: seeded.id } }).catch(() => undefined);
  });
});

describe('unique_extend parity — housekeeping_setups.code', () => {
  const stamp = Date.now();

  const cleanup = async (id?: number) => {
    if (!id) return;
    await prisma.housekeeping_setup_room_types.deleteMany({ where: { housekeeping_setup_id: BigInt(id) } }).catch(() => undefined);
    await prisma.housekeeping_setup_rooms.deleteMany({ where: { housekeeping_setup_id: BigInt(id) } }).catch(() => undefined);
    await prisma.housekeeping_setups.delete({ where: { id: BigInt(id) } }).catch(() => undefined);
  };

  it('rejects a duplicate setup code in the same property', async () => {
    const code = `HK-${stamp}`;
    const first = await request(app)
      .post('/api/cms/housekeeping/setups')
      .send({ code, item_name: 'Item A', status: true });
    expect(first.status).toBe(200);
    const id = Number(parseBody(first)?.data?.id);

    const res = await request(app)
      .post('/api/cms/housekeeping/setups')
      .send({ code, item_name: 'Item B', status: true });
    expect(res.status).toBe(400);
    expect(parseBody(res).message).toMatch(/code has already been taken/i);

    await cleanup(id);
  });
});

describe('unique_extend parity — content_rooms.room_type_id', () => {
  const stamp = Date.now();
  let roomTypeId: bigint;
  const createdIds: number[] = [];

  beforeAll(async () => {
    // Pick a room type that has no content_room yet - the store rejects the FIRST
    // create too if the room type is already linked.
    const used = await prisma.content_rooms.findMany({
      where: { deleted_at: null },
      select: { room_type_id: true },
    });
    const usedIds = new Set(used.map((u: any) => String(u.room_type_id)));
    const all = await prisma.room_types.findMany({
      where: { deleted_at: null, status: 1, property_id: 999n },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const free = all.find((r: any) => !usedIds.has(String(r.id)));
    expect(free).toBeDefined();
    roomTypeId = free!.id;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.content_rooms.delete({ where: { id: BigInt(id) } }).catch(() => undefined);
    }
  });

  it('rejects a second content room for the same room type', async () => {
    const body = {
      property_id: 999,
      room_type_id: String(roomTypeId),
      name: `CR-${stamp}`,
      type_discount: 'percent',
      value_discount: 0,
      status: 1,
    };
    const first = await request(app).post('/api/cms/content-room').send(body);
    expect(first.status).toBe(200);
    createdIds.push(Number(parseBody(first)?.data?.id));

    const res = await request(app)
      .post('/api/cms/content-room')
      .send({ ...body, name: `CR2-${stamp}` });
    expect(res.status).toBe(400);
    expect(JSON.stringify(parseBody(res))).toMatch(/room type id has already been taken/i);
  });
});
