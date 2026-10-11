import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { deleteStoredFile, saveUploadedImage, saveBase64Image } from '../utils/storage';
import { syncRoomConfigImage, syncRoomConfigFacility } from '../services/bookingEngineContent.service';

// Menu 1120 = Master Setup > Room Type, the same id room.routes.ts gates the
// existing room-type image endpoints on.
const MENU_ID = 1120;

const IMAGE_TABLE = 'content_room_images';
const FACILITY_TABLE = 'content_room_facilities';

// react-icons component names the booking engine can resolve
// (hmsBookingEngine/frontend/components/common/room/FacilityIcon.tsx). Kept in
// sync with that map so the picker cannot offer a glyph the portal cannot draw.
export const ROOM_FACILITY_ICONS = [
  'AccessibleIcon', 'Baby', 'Ban', 'Bath', 'Bicycle', 'Briefcase', 'Car', 'Child',
  'Cocktail', 'Coffee', 'ConciergeBell', 'Couch', 'Dumbbell', 'Fire', 'GlassCheers',
  'Globe', 'HandPaper', 'HotTub', 'Lock', 'MapMarkedAlt', 'MoneyBillWave', 'Mountain',
  'MugHot', 'Parking', 'ShieldAlt', 'Shower', 'ShuttleVan', 'Smoking', 'Snowflake',
  'Spa', 'Sun', 'Suitcase', 'SwimmingPool', 'Taxi', 'TicketAlt', 'Tree', 'Tshirt',
  'Tv', 'UmbrellaBeach', 'Users', 'Utensils', 'Video', 'Water', 'Wifi', 'Wind',
  'WineGlassAlt',
];

// Preset amenity names. The operator can type anything (the column is free text and
// existing rows carry names like "43\" Smart TV"), but a picker saves them typing the
// same 40 rows per room type by hand.
export const ROOM_FACILITY_PRESETS = [
  { value: 'NON SMOKING', label: 'Non Smoking', icon: 'Ban' },
  { value: 'SMOKING', label: 'Smoking', icon: 'Smoking' },
  { value: 'Mini Coolbar', label: 'Mini Coolbar', icon: 'GlassCheers' },
  { value: 'Free Wifi', label: 'Free Wifi', icon: 'Wifi' },
  { value: 'Air Conditioning', label: 'Air Conditioning', icon: 'Snowflake' },
  { value: 'Flat TV', label: 'Flat TV', icon: 'Tv' },
  { value: 'Hairdryer', label: 'Hairdryer', icon: 'Wind' },
  { value: 'Shower', label: 'Shower', icon: 'Shower' },
  { value: 'Bathtub', label: 'Bathtub', icon: 'Bath' },
  { value: 'Coffee Maker', label: 'Coffee Maker', icon: 'Coffee' },
  { value: 'Electric Kettle', label: 'Electric Kettle', icon: 'MugHot' },
  { value: 'In-Room Safe', label: 'In-Room Safe', icon: 'Lock' },
  { value: 'Work Desk', label: 'Work Desk', icon: 'Briefcase' },
  { value: 'Wardrobe', label: 'Wardrobe', icon: 'Suitcase' },
  { value: 'Luggage Storage', label: 'Luggage Storage', icon: 'Suitcase' },
  { value: 'Laundry Service', label: 'Laundry Service', icon: 'Tshirt' },
  { value: 'Room Service', label: 'Room Service', icon: 'ConciergeBell' },
  { value: 'Bathrobe & Slippers', label: 'Bathrobe & Slippers', icon: 'Tshirt' },
  { value: 'Free Breakfast', label: 'Free Breakfast', icon: 'Coffee' },
  { value: '24-Hour Reception', label: '24-Hour Reception', icon: 'ConciergeBell' },
  { value: 'Sea View', label: 'Sea View', icon: 'Water' },
  { value: 'City View', label: 'City View', icon: 'Mountain' },
  { value: 'Pool View', label: 'Pool View', icon: 'SwimmingPool' },
  { value: 'Garden View', label: 'Garden View', icon: 'Tree' },
  { value: 'Connecting Door', label: 'Connecting Door', icon: 'Users' },
  { value: 'Accessible Room', label: 'Accessible Room', icon: 'AccessibleIcon' },
  { value: 'Baby Crib', label: 'Baby Crib', icon: 'Baby' },
  { value: 'Extra Bed', label: 'Extra Bed', icon: 'Child' },
  { value: 'Towel', label: 'Towel', icon: 'Tshirt' },
  { value: 'Toiletries', label: 'Toiletries', icon: 'Tshirt' },
  { value: 'Dental Kit', label: 'Dental Kit', icon: 'Tshirt' },
  { value: 'Slippers', label: 'Slippers', icon: 'Tshirt' },
  { value: 'Smoke Detector', label: 'Smoke Detector', icon: 'ShieldAlt' },
  { value: 'Fire Extinguisher', label: 'Fire Extinguisher', icon: 'Fire' },
  { value: 'Keyless Entry', label: 'Keyless Entry', icon: 'Lock' },
  { value: 'Smart TV', label: 'Smart TV', icon: 'Tv' },
  { value: 'Bluetooth Speaker', label: 'Bluetooth Speaker', icon: 'GlassCheers' },
];

function parsePaging(query: any) {
  return {
    page: parseInt(query.page as string) || 1,
    limit: Math.min(parseInt(query.limit as string) || 50, 200),
    search: (query.search as string) || '',
  };
}

function perm(req: Request) {
  const flags = getPermissionFlags(req.user, MENU_ID);
  return {
    view: true,
    add: req.user?.superUser || flags.add,
    edit: req.user?.superUser || flags.edit,
    delete: req.user?.superUser || flags.delete,
  };
}

function propertyId(req: Request): bigint {
  return BigInt(req.user?.lastProperty ?? 0);
}

function idParam(value: any): bigint | null {
  const s = String(value ?? '');
  return /^\d+$/.test(s) ? BigInt(s) : null;
}

function coerceStatus(value: any, fallback = 1): number {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  if (value && typeof value === 'object' && value.value !== undefined) return coerceStatus(value.value, fallback);
  return fallback;
}

// jsonSafe lives in utils/response as bigintToNumber; content_room_* rows are read
// through $queryRawUnsafe (the `icon` / `room_type_id` columns were added after the
// last prisma generate), and Postgres hands BigInt back for bigint columns, which
// res.json() cannot serialise.
function jsonSafe(value: any): any {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/**
 * A room type can own several physical rooms (content_rooms). The facility/image
 * rows hang off a physical room through the NOT NULL content_room_id foreign key,
 * but the booking engine addresses them by room_type_id. So a room-type-scoped write
 * resolves the room type's FIRST content_room and reuses that row set.
 *
 * Verified on this database: every existing content_room_facilities /
 * content_room_images row resolves to a room_type_id, so no row is unreachable.
 */
async function anchorContentRoomId(roomTypeId: bigint, propertyId: bigint): Promise<bigint | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select id from content_rooms
      where room_type_id = $1 and property_id = $2 and deleted_at is null
      order by id asc limit 1`,
    roomTypeId.toString(),
    propertyId.toString()
  );
  return rows.length ? BigInt(rows[0].id) : null;
}

async function assertRoomType(roomTypeId: bigint, propertyId: bigint): Promise<boolean> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select id from room_types where id = $1 and property_id = $2 and deleted_at is null`,
    roomTypeId.toString(),
    propertyId.toString()
  );
  return rows.length > 0;
}

/**
 * Master data shared by both forms: the room types of the current property, plus
 * the facility presets and the icon names the portal can draw.
 *
 * Module-level on purpose. It used to be `private static async roomTypeMaster()`
 * called as `this.roomTypeMaster(req)`, which is undefined here: Express invokes
 * the handler as a bare function, so `this` is undefined in the compiled ES module
 * and every `/create` answered 500 "Failed to load room image" — the form could
 * never load, so the whole screen was unusable.
 */
async function roomTypeMaster(req: Request) {
  const pid = propertyId(req);
  const roomTypes: any[] = await prisma.$queryRawUnsafe(
    `select id, name, description from room_types
      where property_id = $1 and deleted_at is null and status = 1
      order by name asc`,
    pid.toString()
  );
  return {
    room_types: roomTypes.map((r) => ({
      value: Number(r.id),
      label: r.description || r.name,
    })),
    facility_presets: ROOM_FACILITY_PRESETS,
    facility_icons: ROOM_FACILITY_ICONS.map((i) => ({ value: i, label: i })),
    statuses: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }],
  };
}

export class ContentRoomController {
  // ═══════════════════════════════════════════════════════════════════════════
  // Images — content_room_images
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /cms/content/room/config-image?room_type_id=N
   *
   * room_type_id is required: without it the endpoint would return every image of
   * the property, which is not a list any screen can render.
   */
  static async imageList(req: Request, res: Response): Promise<void> {
    try {
      const roomTypeId = idParam(req.query.room_type_id ?? req.params.roomTypeId);
      if (!roomTypeId) {
        badRequest(res, 'room_type_id is required');
        return;
      }
      const { page, limit, search } = parsePaging(req.query);
      const pid = propertyId(req);
      const offset = (page - 1) * limit;

      const params: any[] = [roomTypeId.toString(), pid.toString()];
      let searchClause = '';
      if (search) {
        params.push(`%${search}%`);
        searchClause = `and name ilike $${params.length}`;
      }
      params.push(String(limit), String(offset));

      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, content_room_id, room_type_id, property_id, name, image, sort, status,
                created_at, updated_at
           from ${IMAGE_TABLE}
          where room_type_id = $1 and property_id = $2 and deleted_at is null ${searchClause}
          order by sort asc, id asc
          limit $${params.length - 1} offset $${params.length}`,
        ...params
      );
      const totalRows: any[] = await prisma.$queryRawUnsafe(
        `select count(*)::int as total from ${IMAGE_TABLE}
          where room_type_id = $1 and property_id = $2 and deleted_at is null ${searchClause}`,
        ...params.slice(0, search ? 3 : 2)
      );
      const total = Number(totalRows[0]?.total ?? 0);

      success(res, jsonSafe(rows), 'Success', 200, {
        table: [
          { label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: false },
          { label: 'Name', key: 'name', type: 'text', is_search: true },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: perm(req),
        pagination: {
          current_page: page,
          last_page: Math.max(1, Math.ceil(total / limit)),
          per_page: limit,
          total,
          from: total ? offset + 1 : 0,
          to: Math.min(offset + limit, total),
        },
      });
    } catch (err: any) {
      console.error('ContentRoom imageList error:', err);
      error(res, 'Failed to list room images', 500);
    }
  }

  /**
   * GET /cms/content/room/config-image/create | /:id/update
   *
   * Answers the room type list so the screen can offer "which room type is this
   * for" without a second round trip, plus the facility/image master data.
   */
  static async imageForm(req: Request, res: Response): Promise<void> {
    try {
      const master = await roomTypeMaster(req);
      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master });
        return;
      }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, content_room_id, room_type_id, property_id, name, image, sort, status,
                created_at, updated_at
           from ${IMAGE_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!rows.length) { notFound(res, 'Room image not found'); return; }
      success(res, jsonSafe(rows[0]), 'Success', 200, { master });
    } catch (err: any) {
      console.error('ContentRoom imageForm error:', err);
      error(res, 'Failed to load room image', 500);
    }
  }

  /**
   * POST /cms/content/room/config-image  (multipart: image, name, sort, status, room_type_id)
   */
  static async imageStore(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const roomTypeId = idParam(body.room_type_id ?? req.params.roomTypeId);
      const name = (body.name ?? '').toString().trim();
      const file = (req.file ?? null) as Express.Multer.File | null;
      const dataUri = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : null;

      const errors: Record<string, string[]> = {};
      if (!roomTypeId) errors.room_type_id = ['The room type field is required.'];
      if (!name) errors.name = ['The name field is required.'];
      if (!file && !dataUri) errors.image = ['The image field is required.'];
      if (Object.keys(errors).length) { validationError(res, errors); return; }
      // validationError() already answered, so roomTypeId is non-null past this line.
      const rtId = roomTypeId as bigint;

      const pid = propertyId(req);
      if (!(await assertRoomType(rtId, pid))) {
        badRequest(res, 'Room type not found for this property.');
        return;
      }
      const contentRoomId = await anchorContentRoomId(rtId, pid);
      if (contentRoomId === null) {
        badRequest(res, 'This room type has no physical room yet. Create the room first.');
        return;
      }

      // multipart upload -> storage/image-room-type (the folder the booking engine
      // already points at); base64 payload -> same helper saveBase64Image uses.
      const folder = `image-room-type/${rtId}`;
      const stored = file
        ? saveUploadedImage(file as any, folder, 2 * 1024 * 1024)
        : (saveBase64Image(dataUri!, folder, name.replace(/\s+/g, '-'))?.filePath ?? null);
      if (!stored) {
        badRequest(res, 'The image could not be stored. Use JPEG, PNG, JPG or GIF under 2 MB.');
        return;
      }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `insert into ${IMAGE_TABLE}
           (uuid, content_room_id, room_type_id, property_id, name, image, sort, status,
            created_at, updated_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), $9)
         returning id, uuid, content_room_id, room_type_id, property_id, name, image, sort, status`,
        crypto.randomUUID(),
        contentRoomId.toString(),
        rtId.toString(),
        pid.toString(),
        name,
        `/${stored}`,
        Number(body.sort ?? 0),
        coerceStatus(body.status),
        req.user?.id ? String(req.user.id) : null
      );

      // HMS is the source of truth; the booking engine reads its own MySQL copy.
      // A failed push must not fail the save (parity with the reference model's
      // try/catch \Throwable around the HTTP call).
      const sync = await syncRoomConfigImage(rows[0]);
      if (!sync.attempted || sync.status >= 400) {
        console.warn('[content-room] image sync to booking engine did not succeed:', sync.status);
      }

      success(res, jsonSafe(rows[0]), 'Room image created successfully.');
    } catch (err: any) {
      console.error('ContentRoom imageStore error:', err);
      error(res, 'Failed to create room image', 500);
    }
  }

  /**
   * PUT|POST /cms/content/room/config-image/:id
   *
   * The table editor posts to `uri + "/" + id`, so POST has to behave like PUT.
   */
  static async imageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Room image not found'); return; }
      const pid = propertyId(req);
      const existing: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, image, room_type_id, property_id from ${IMAGE_TABLE}
          where id = $1 and property_id = $2 and deleted_at is null`,
        id.toString(),
        pid.toString()
      );
      if (!existing.length) { notFound(res, 'Room image not found'); return; }

      const body = req.body ?? {};
      const file = (req.file ?? null) as Express.Multer.File | null;
      const dataUri = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : null;

      let imagePath: string | null = existing[0].image ?? null;
      if (file || dataUri) {
        const stored = file
          ? saveUploadedImage(file as any, `image-room-type/${existing[0].room_type_id}`, 2 * 1024 * 1024)
          : (saveBase64Image(dataUri!, `image-room-type/${existing[0].room_type_id}`, 'image')?.filePath ?? null);
        if (stored) {
          // Only unlink the previous file once the new one is safely on disk.
          if (imagePath) deleteStoredFile(imagePath);
          imagePath = `/${stored}`;
        }
      }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${IMAGE_TABLE}
            set name = coalesce($2, name),
                image = coalesce($3, image),
                sort = coalesce($4, sort),
                status = coalesce($5, status),
                updated_at = now(),
                updated_by = $6
          where id = $1
        returning id, uuid, content_room_id, room_type_id, property_id, name, image, sort, status`,
        id.toString(),
        body.name !== undefined ? String(body.name) : null,
        imagePath,
        body.sort !== undefined ? Number(body.sort) : null,
        body.status !== undefined ? coerceStatus(body.status) : null,
        req.user?.id ? String(req.user.id) : null
      );

      const sync = await syncRoomConfigImage(rows[0]);
      if (!sync.attempted || sync.status >= 400) {
        console.warn('[content-room] image sync to booking engine did not succeed:', sync.status);
      }

      success(res, jsonSafe(rows[0]), 'Room image updated successfully.');
    } catch (err: any) {
      console.error('ContentRoom imageUpdate error:', err);
      error(res, 'Failed to update room image', 500);
    }
  }

  static async imageDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Room image not found'); return; }
      const pid = propertyId(req);
      const existing: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, image from ${IMAGE_TABLE}
          where id = $1 and property_id = $2 and deleted_at is null`,
        id.toString(),
        pid.toString()
      );
      if (!existing.length) { notFound(res, 'Room image not found'); return; }

      // `$2` has to appear in the WHERE clause. It used to be passed but never
      // referenced, and Postgres rejects a raw query whose placeholder type it cannot
      // infer ("tidak dapat menentukan tipe data dari parameter $2") — so every delete
      // answered 500 and the row stayed visible.
      await prisma.$queryRawUnsafe(
        `update ${IMAGE_TABLE}
            set deleted_at = now(), updated_at = now(), updated_by = $3
          where id = $1 and property_id = $2 and deleted_at is null`,
        id.toString(),
        pid.toString(),
        req.user?.id ? String(req.user.id) : null
      );

      const sync = await syncRoomConfigImage(existing[0], true);
      if (!sync.attempted || sync.status >= 400) {
        console.warn('[content-room] image delete sync to booking engine did not succeed:', sync.status);
      }
      if (existing[0].image) deleteStoredFile(existing[0].image);

      success(res, [], 'Room image deleted successfully.');
    } catch (err: any) {
      console.error('ContentRoom imageDestroy error:', err);
      error(res, 'Failed to delete room image', 500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Facilities — content_room_facilities
  // ═══════════════════════════════════════════════════════════════════════════

  static async facilityList(req: Request, res: Response): Promise<void> {
    try {
      const roomTypeId = idParam(req.query.room_type_id ?? req.params.roomTypeId);
      if (!roomTypeId) {
        badRequest(res, 'room_type_id is required');
        return;
      }
      const { page, limit, search } = parsePaging(req.query);
      const pid = propertyId(req);
      const offset = (page - 1) * limit;

      const params: any[] = [roomTypeId.toString(), pid.toString()];
      let searchClause = '';
      if (search) {
        params.push(`%${search}%`);
        searchClause = `and name ilike $${params.length}`;
      }
      params.push(String(limit), String(offset));

      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, content_room_id, room_type_id, property_id, name, icon, image, sort, status,
                created_at, updated_at
           from ${FACILITY_TABLE}
          where room_type_id = $1 and property_id = $2 and deleted_at is null ${searchClause}
          order by sort asc, id asc
          limit $${params.length - 1} offset $${params.length}`,
        ...params
      );
      const totalRows: any[] = await prisma.$queryRawUnsafe(
        `select count(*)::int as total from ${FACILITY_TABLE}
          where room_type_id = $1 and property_id = $2 and deleted_at is null ${searchClause}`,
        ...params.slice(0, search ? 3 : 2)
      );
      const total = Number(totalRows[0]?.total ?? 0);

      success(res, jsonSafe(rows), 'Success', 200, {
        table: [
          { label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: false },
          { label: 'Name', key: 'name', type: 'text', is_search: true },
          { label: 'Icon', key: 'icon', type: 'text', is_search: false },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: perm(req),
        pagination: {
          current_page: page,
          last_page: Math.max(1, Math.ceil(total / limit)),
          per_page: limit,
          total,
          from: total ? offset + 1 : 0,
          to: Math.min(offset + limit, total),
        },
      });
    } catch (err: any) {
      console.error('ContentRoom facilityList error:', err);
      error(res, 'Failed to list room facilities', 500);
    }
  }

  static async facilityForm(req: Request, res: Response): Promise<void> {
    try {
      const master = await roomTypeMaster(req);
      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master });
        return;
      }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, content_room_id, room_type_id, property_id, name, icon, image, sort, status,
                created_at, updated_at
           from ${FACILITY_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!rows.length) { notFound(res, 'Room facility not found'); return; }
      success(res, jsonSafe(rows[0]), 'Success', 200, { master });
    } catch (err: any) {
      console.error('ContentRoom facilityForm error:', err);
      error(res, 'Failed to load room facility', 500);
    }
  }

  /**
   * POST /cms/content/room/config-facility  (json or multipart)
   *
   * `image` is optional here. Every pre-migration facility image file is gone, so a
   * facility with only a name + icon is a complete, renderable row — requiring a
   * picture would force the operator to source 40 icons per room type for data the
   * portal draws from `icon` anyway.
   */
  static async facilityStore(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const roomTypeId = idParam(body.room_type_id ?? req.params.roomTypeId);
      const name = (body.name ?? '').toString().trim();
      const icon = (body.icon ?? '').toString().trim() || null;

      const errors: Record<string, string[]> = {};
      if (!roomTypeId) errors.room_type_id = ['The room type field is required.'];
      if (!name) errors.name = ['The name field is required.'];
      if (Object.keys(errors).length) { validationError(res, errors); return; }
      // validationError() already answered, so roomTypeId is non-null past this line.
      const rtId = roomTypeId as bigint;

      const pid = propertyId(req);
      if (!(await assertRoomType(rtId, pid))) {
        badRequest(res, 'Room type not found for this property.');
        return;
      }
      const contentRoomId = await anchorContentRoomId(rtId, pid);
      if (contentRoomId === null) {
        badRequest(res, 'This room type has no physical room yet. Create the room first.');
        return;
      }

      let imagePath: string | null = null;
      const file = (req.file ?? null) as Express.Multer.File | null;
      const dataUri = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : null;
      if (file) {
        imagePath = saveUploadedImage(file as any, `facility/${rtId}`, 1024 * 1024);
        if (imagePath) imagePath = `/${imagePath}`;
      } else if (dataUri) {
        const saved = saveBase64Image(dataUri, `facility/${rtId}`, name.replace(/\s+/g, '-'));
        if (saved) imagePath = `/${saved.filePath}`;
      }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `insert into ${FACILITY_TABLE}
           (uuid, content_room_id, room_type_id, property_id, name, icon, image, sort, status,
            created_at, updated_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10)
         returning id, uuid, content_room_id, room_type_id, property_id, name, icon, image, sort, status`,
        crypto.randomUUID(),
        contentRoomId.toString(),
        rtId.toString(),
        pid.toString(),
        name,
        icon,
        imagePath,
        Number(body.sort ?? 0),
        coerceStatus(body.status),
        req.user?.id ? String(req.user.id) : null
      );

      const sync = await syncRoomConfigFacility(rows[0]);
      if (!sync.attempted || sync.status >= 400) {
        console.warn('[content-room] facility sync to booking engine did not succeed:', sync.status);
      }

      success(res, jsonSafe(rows[0]), 'Room facility created successfully.');
    } catch (err: any) {
      console.error('ContentRoom facilityStore error:', err);
      error(res, 'Failed to create room facility', 500);
    }
  }

  static async facilityUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Room facility not found'); return; }
      const pid = propertyId(req);
      const existing: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, image, room_type_id, property_id from ${FACILITY_TABLE}
          where id = $1 and property_id = $2 and deleted_at is null`,
        id.toString(),
        pid.toString()
      );
      if (!existing.length) { notFound(res, 'Room facility not found'); return; }

      const body = req.body ?? {};
      let imagePath: string | null = existing[0].image ?? null;
      const file = (req.file ?? null) as Express.Multer.File | null;
      const dataUri = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : null;
      if (file || dataUri) {
        const stored = file
          ? saveUploadedImage(file as any, `facility/${existing[0].room_type_id}`, 1024 * 1024)
          : (saveBase64Image(dataUri!, `facility/${existing[0].room_type_id}`, 'facility')?.filePath ?? null);
        if (stored) {
          if (imagePath) deleteStoredFile(imagePath);
          imagePath = `/${stored}`;
        }
      }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${FACILITY_TABLE}
            set name = coalesce($2, name),
                icon = coalesce($3, icon),
                image = coalesce($4, image),
                sort = coalesce($5, sort),
                status = coalesce($6, status),
                updated_at = now(),
                updated_by = $7
          where id = $1
        returning id, uuid, content_room_id, room_type_id, property_id, name, icon, image, sort, status`,
        id.toString(),
        body.name !== undefined ? String(body.name) : null,
        body.icon !== undefined ? (String(body.icon).trim() || null) : null,
        imagePath,
        body.sort !== undefined ? Number(body.sort) : null,
        body.status !== undefined ? coerceStatus(body.status) : null,
        req.user?.id ? String(req.user.id) : null
      );

      const sync = await syncRoomConfigFacility(rows[0]);
      if (!sync.attempted || sync.status >= 400) {
        console.warn('[content-room] facility sync to booking engine did not succeed:', sync.status);
      }

      success(res, jsonSafe(rows[0]), 'Room facility updated successfully.');
    } catch (err: any) {
      console.error('ContentRoom facilityUpdate error:', err);
      error(res, 'Failed to update room facility', 500);
    }
  }

  static async facilityDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Room facility not found'); return; }
      const pid = propertyId(req);
      const existing: any[] = await prisma.$queryRawUnsafe(
        `select id, uuid, image from ${FACILITY_TABLE}
          where id = $1 and property_id = $2 and deleted_at is null`,
        id.toString(),
        pid.toString()
      );
      if (!existing.length) { notFound(res, 'Room facility not found'); return; }

      // Same `$2` placeholder fix as imageDestroy above.
      await prisma.$queryRawUnsafe(
        `update ${FACILITY_TABLE}
            set deleted_at = now(), updated_at = now(), updated_by = $3
          where id = $1 and property_id = $2 and deleted_at is null`,
        id.toString(),
        pid.toString(),
        req.user?.id ? String(req.user.id) : null
      );

      const sync = await syncRoomConfigFacility(existing[0], true);
      if (!sync.attempted || sync.status >= 400) {
        console.warn('[content-room] facility delete sync to booking engine did not succeed:', sync.status);
      }
      if (existing[0].image) deleteStoredFile(existing[0].image);

      success(res, [], 'Room facility deleted successfully.');
    } catch (err: any) {
      console.error('ContentRoom facilityDestroy error:', err);
      error(res, 'Failed to delete room facility', 500);
    }
  }
}
