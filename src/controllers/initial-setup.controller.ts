import { Request, Response } from 'express';
import { pool } from '../config/prisma';
import { badRequest, error, notFound, success } from '../utils/response';

/**
 * INITIAL SETUP - onboarding a newly joined property.
 *
 * Two jobs:
 *   1. tell support what master data a property already has and what is missing;
 *   2. fill the gap in one shot instead of ~25 manual setup screens.
 *
 * Everything is idempotent (natural-key upsert) so a half-finished run can be
 * repeated safely. When the optimized database (setup.* / audit.* schemas) is
 * not deployed the controller falls back to plain public.* SQL, so the menu
 * also works against the legacy database.
 */

const MENU_ID = 1200;

type Q = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

function resolvePropertyId(req: Request): bigint | null {
  const raw =
    (req.query.property_id as string) ||
    (req.body?.property_id as string) ||
    (req.user?.lastProperty != null ? String(req.user.lastProperty) : '');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? BigInt(n) : null;
}

function actorId(req: Request): bigint | null {
  return req.user?.id != null ? BigInt(req.user.id) : null;
}

/** True when the optimized database is in place. */
let setupSchemaCached: boolean | null = null;
async function hasSetupSchema(q: Q): Promise<boolean> {
  if (setupSchemaCached !== null) return setupSchemaCached;
  try {
    const r = await q(
      `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'setup') AS ok`,
    );
    setupSchemaCached = Boolean(r.rows[0]?.ok);
  } catch {
    setupSchemaCached = false;
  }
  return setupSchemaCached;
}

async function resetSetupSchemaCache(): Promise<void> {
  setupSchemaCached = null;
}

async function inTransaction<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn((sql, params) => client.query(sql, params as any[]));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const q: Q = (sql, params) => pool.query(sql, params as any[]) as any;

/**
 * Every success response MUST carry code 200.
 * frontend-node/components/helper FetchData() treats anything other than 200 as
 * a failure and fires a red error toast, so a 201 "created" reply showed up as
 * an error even though the row was written. Laravel always answers 200 here.
 */

/* ------------------------------------------------------------------ */
/* 1. Overview                                                         */
/* ------------------------------------------------------------------ */

export async function overview(req: Request, res: Response) {
  try {
    const propertyId = resolvePropertyId(req);
    if (!propertyId) return badRequest(res, 'property_id is required');

    const property = await q(
      `SELECT id, name, slug, address, email, telp, is_booking_engine, status
         FROM public.properties WHERE id = $1 AND deleted_at IS NULL`,
      [propertyId],
    );
    if (!property.rows[0]) return notFound(res, 'Property not found');

    const advanced = await hasSetupSchema(q);

    const [counts, byGroup, codeCounts] = await Promise.all([
      q(
        `SELECT
            (SELECT count(*) FROM public.types        WHERE property_id=$1 AND "group"='building'           AND deleted_at IS NULL) AS building,
            (SELECT count(*) FROM public.types        WHERE property_id=$1 AND "group"='floor'              AND deleted_at IS NULL) AS floor,
            (SELECT count(*) FROM public.types        WHERE property_id=$1 AND "group"='room-configuration' AND deleted_at IS NULL) AS room_configuration,
            (SELECT count(*) FROM public.types        WHERE property_id=$1 AND "group"='room-type-grouping' AND deleted_at IS NULL) AS room_type_grouping,
            (SELECT count(*) FROM public.room_types   WHERE property_id=$1 AND deleted_at IS NULL) AS room_type,
            (SELECT count(*) FROM public.rooms        WHERE property_id=$1 AND deleted_at IS NULL) AS room,
            (SELECT count(*) FROM public.roles        WHERE property_id=$1 AND deleted_at IS NULL) AS role,
            (SELECT count(*) FROM public.report_permissions WHERE property_id=$1) AS report_permission,
            (SELECT count(*) FROM public.menus       WHERE deleted_at IS NULL) AS menu,
            (SELECT count(*) FROM public.permissions WHERE deleted_at IS NULL) AS permission,
            (SELECT count(*) FROM public.users       WHERE deleted_at IS NULL) AS user`,
        [propertyId],
      ),
      q(
        `SELECT "group" AS group, count(*)::int AS total
           FROM public.types
          WHERE property_id = $1 AND deleted_at IS NULL
          GROUP BY 1 ORDER BY 2 DESC`,
        [propertyId],
      ),
      q(
        `SELECT
            (SELECT count(*) FROM public.code_billings WHERE property_id=$1 AND deleted_at IS NULL) AS code_billing,
            (SELECT count(*) FROM public.code_gls     WHERE property_id=$1 AND deleted_at IS NULL) AS code_gl,
            (SELECT count(*) FROM public.code_posts    WHERE property_id=$1 AND deleted_at IS NULL) AS code_post,
            (SELECT count(*) FROM public.code_items    WHERE property_id=$1 AND deleted_at IS NULL) AS code_item,
            (SELECT count(*) FROM public.type_payments WHERE property_id=$1 AND deleted_at IS NULL) AS payment_method`,
        [propertyId],
      ),
    ]);

    return success(
      res,
      {
        property: property.rows[0],
        counts: counts.rows[0],
        codes: codeCounts.rows[0],
        tags_by_group: byGroup.rows,
        advanced_schema: advanced,
        menu_id: MENU_ID,
      },
      'Initial setup overview',
    );
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load overview');
  }
}

/* ------------------------------------------------------------------ */
/* 2. Checklist                                                         */
/* ------------------------------------------------------------------ */

export async function checklist(req: Request, res: Response) {
  try {
    const propertyId = resolvePropertyId(req);
    if (!propertyId) return badRequest(res, 'property_id is required');

    if (await hasSetupSchema(q)) {
      try {
        const r = await q(`SELECT * FROM "setup"."fn_checklist"($1)`, [propertyId]);
        return success(res, r.rows, 'Setup checklist');
      } catch {
        /* fall through to the JS implementation */
      }
    }

    const r = await q(
      `SELECT
        'property'           AS step, 'Property Profile'    AS label,
          CASE WHEN EXISTS (SELECT 1 FROM public.properties WHERE id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END AS done
       UNION ALL SELECT 'building','Building',
          CASE WHEN EXISTS (SELECT 1 FROM public.types WHERE property_id=$1 AND "group"='building' AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'floor','Floor',
          CASE WHEN EXISTS (SELECT 1 FROM public.types WHERE property_id=$1 AND "group"='floor' AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'room_configuration','Room Configurator',
          CASE WHEN EXISTS (SELECT 1 FROM public.types WHERE property_id=$1 AND "group"='room-configuration' AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'room_type','Room Type',
          CASE WHEN EXISTS (SELECT 1 FROM public.room_types WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'room','Room Setup',
          CASE WHEN EXISTS (SELECT 1 FROM public.rooms WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'code_billing','Billing Code',
          CASE WHEN EXISTS (SELECT 1 FROM public.code_billings WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'code_gl','General Ledger (GL)',
          CASE WHEN EXISTS (SELECT 1 FROM public.code_gls WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'code_post','Post Code',
          CASE WHEN EXISTS (SELECT 1 FROM public.code_posts WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'code_item','Item Code',
          CASE WHEN EXISTS (SELECT 1 FROM public.code_items WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'payment_method','Payment Code',
          CASE WHEN EXISTS (SELECT 1 FROM public.type_payments WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'role','Role',
          CASE WHEN EXISTS (SELECT 1 FROM public.roles WHERE property_id=$1 AND deleted_at IS NULL) THEN 1 ELSE 0 END
       UNION ALL SELECT 'report_permission','Report Permission',
          CASE WHEN EXISTS (SELECT 1 FROM public.report_permissions WHERE property_id=$1) THEN 1 ELSE 0 END
       UNION ALL SELECT 'user','User',
          CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE deleted_at IS NULL) THEN 1 ELSE 0 END`,
      [propertyId],
    );

    const rows = r.rows.map((x: any) => ({ ...x, total: 1, is_complete: x.done >= 1 }));
    const done = rows.filter((x: any) => x.is_complete).length;
    return success(
      res,
      { steps: rows, done, total: rows.length, percent: rows.length ? Math.round((done / rows.length) * 100) : 0 },
      'Setup checklist',
    );
  } catch (e: any) {
    return error(res, e?.message || 'Failed to build checklist');
  }
}

/* ------------------------------------------------------------------ */
/* 1b. Property / tag / room-type pickers                               */
/*     Kept on this controller on purpose: reading them through the      */
/*     regular /cms/setup and /cms/room-types routes would require the   */
/*     ENGINEERING SETUP / Room Setup menu permissions, which a support  */
/*     role doing an onboarding does not necessarily hold.               */
/* ------------------------------------------------------------------ */

export async function properties(req: Request, res: Response) {
  try {
    const r = await q(
      `SELECT p.id, p.name, p.slug, p.status
         FROM public.properties p
         LEFT JOIN public.model_has_properties mp
                ON mp.property_id = p.id AND mp.model_type = 'App\\Models\\User' AND mp.model_id = $1
        WHERE p.deleted_at IS NULL
          AND ($2::boolean OR mp.model_id IS NOT NULL)
        ORDER BY p.name`,
      [req.user?.id ?? 0, Boolean(req.user?.superUser)],
    );
    return success(res, r.rows, 'Properties');
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load properties');
  }
}

export async function tags(req: Request, res: Response) {
  try {
    const propertyId = resolvePropertyId(req);
    if (!propertyId) return badRequest(res, 'property_id is required');
    const group = req.query?.group ? String(req.query.group) : null;

    const r = group
      ? await q(
          `SELECT id, name, description, sort, status, image, text
             FROM public.types
            WHERE property_id = $1 AND "group" = $2 AND deleted_at IS NULL
            ORDER BY sort, name`,
          [propertyId, group],
        )
      : await q(
          `SELECT id, "group", name, description, sort, status, image, text
             FROM public.types
            WHERE property_id = $1 AND deleted_at IS NULL
            ORDER BY "group", sort, name`,
          [propertyId],
        );

    if (group) return success(res, r.rows, 'Tags');
    const grouped: Record<string, any[]> = {};
    for (const row of r.rows) {
      const key = row.group || 'other';
      (grouped[key] ||= []).push(row);
    }
    return success(res, grouped, 'Tags by group');
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load tags');
  }
}

export async function roomTypeList(req: Request, res: Response) {
  try {
    const propertyId = resolvePropertyId(req);
    if (!propertyId) return badRequest(res, 'property_id is required');
    const r = await q(
      `SELECT id, name, description, rate, min_rate, status
         FROM public.room_types
        WHERE property_id = $1 AND deleted_at IS NULL
        ORDER BY sort, name`,
      [propertyId],
    );
    return success(res, r.rows, 'Room types');
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load room types');
  }
}

/**
 * Create / update a room type during onboarding.
 * A brand new property has zero room types, which blocks the Room Generator,
 * so the wizard needs to be able to make one inline.
 */
export async function roomTypeStore(req: Request, res: Response) {
  try {
    const propertyId = BigInt(req.body?.property_id ?? req.query.property_id);
    const name = String(req.body?.name ?? '').trim();
    if (!propertyId) return badRequest(res, 'property_id is required');
    if (!name) return badRequest(res, 'name is required');

    const actor = actorId(req);
    const description = req.body?.description ?? null;
    const specification = req.body?.specification ?? null;
    const num = (v: any, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    // room_types.rate / min_rate / sort / status are NOT NULL in the schema
    const rate = num(req.body?.rate, 0);
    const minRate = num(req.body?.min_rate, rate);
    const sort = num(req.body?.sort, 0);
    const status = req.body?.status === undefined ? 1 : num(req.body.status, 1) ? 1 : 0;

    const found = await q(
      `SELECT id FROM public.room_types
        WHERE property_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL LIMIT 1`,
      [propertyId, name],
    );

    let id: bigint;
    if (found.rows[0]) {
      const upd = await q(
        `UPDATE public.room_types
            SET description    = COALESCE($2, description),
                specification  = COALESCE($3, specification),
                rate           = $4,
                min_rate       = $5,
                sort           = COALESCE($6, sort),
                status         = $7,
                updated_by     = $8,
                updated_at     = now()
          WHERE id = $1 RETURNING id`,
        [found.rows[0].id, description, specification, rate, minRate, sort, status, actor],
      );
      id = upd.rows[0].id;
    } else {
      const ins = await q(
        `INSERT INTO public.room_types
            (property_id, name, description, specification, is_physical, rate, min_rate, sort, status,
             created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,now(),$9,now())
         RETURNING id`,
        [propertyId, name, description, specification, rate, minRate, sort, status, actor],
      );
      id = ins.rows[0].id;
    }

    // Room type <-> room type grouping lives in the Type pivot, exactly like
    // Room::formatData() reads its floor/building tags. Accepts a grouping id or
    // a grouping name so the wizard can pass whatever the grid already holds.
    await syncRoomTypeGrouping(propertyId, id, req.body?.room_type_grouping, actor);

    const row = await q(`SELECT id, name, description, specification, rate, min_rate, status FROM public.room_types WHERE id = $1`, [id]);
    const grouping = await roomTypeGroupingOf(propertyId, id);
    return success(
      res,
      { ...row.rows[0], room_type_grouping: grouping },
      found.rows[0] ? 'Room type updated' : 'Room type created',
    );
  } catch (e: any) {
    return error(res, e?.message || 'Failed to save room type');
  }
}

async function resolveGrouping(propertyId: bigint, input: any): Promise<bigint | null> {
  if (input === undefined || input === null || input === '' || input === '-1') return null;
  const raw = String(input).trim();
  const byId = await q(
    `SELECT id FROM public.types
      WHERE id = $2 AND "group" = 'room-type-grouping' AND deleted_at IS NULL
      LIMIT 1`,
    [propertyId, raw],
  );
  if (byId.rows[0]) return byId.rows[0].id;
  const byName = await q(
    `SELECT id FROM public.types
      WHERE property_id = $1 AND "group" = 'room-type-grouping'
        AND lower(name) = lower($2) AND deleted_at IS NULL
      ORDER BY id LIMIT 1`,
    [propertyId, raw],
  );
  return byName.rows[0]?.id ?? null;
}

async function syncRoomTypeGrouping(
  propertyId: bigint,
  roomTypeId: bigint,
  grouping: any,
  actor: bigint | null,
): Promise<void> {
  const gid = await resolveGrouping(propertyId, grouping);
  if (!gid) return;
  await q(
    `DELETE FROM public.model_has_types
      WHERE model_type = 'App\\Models\\RoomType' AND model_id = $1`,
    [roomTypeId],
  );
  await q(
    `INSERT INTO public.model_has_types (type_id, model_type, model_id)
     VALUES ($1, 'App\\Models\\RoomType', $2)
     ON CONFLICT DO NOTHING`,
    [gid, roomTypeId],
  );
}

async function roomTypeGroupingOf(propertyId: bigint, roomTypeId: bigint) {
  const r = await q(
    `SELECT t.id, t.name FROM public.model_has_types m
       JOIN public.types t ON t.id = m.type_id
      WHERE btrim(m.model_type) = 'App\\Models\\RoomType'
        AND m.model_id = $1 AND t."group" = 'room-type-grouping'
      ORDER BY t.id LIMIT 1`,
    [roomTypeId],
  );
  return r.rows[0] ? { value: Number(r.rows[0].id), label: r.rows[0].name } : [];
}

/**
 * Bulk: build one room type per Room Type Grouping.
 *
 * Cloning only brings the grouping LIST across (a `types` row), never the
 * `room_types` rows, so a fresh property ends up with groupings but no room
 * types and the Room Generator has nothing to pick. This fills that gap in one
 * call - and it is idempotent, so re-running skips what already exists.
 */
export async function roomTypesFromGroupings(req: Request, res: Response) {
  try {
    const propertyId = BigInt(req.body?.property_id ?? req.query.property_id);
    if (!propertyId) return badRequest(res, 'property_id is required');

    const wanted: string[] = Array.isArray(req.body?.groupings)
      ? req.body.groupings.map((g: any) => String(g).trim()).filter(Boolean)
      : [];
    const actor = actorId(req);
    const num = (v: any, fb: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fb;
    };
    const rate = num(req.body?.rate, 0);
    const status = req.body?.status === undefined ? 1 : num(req.body.status, 1) ? 1 : 0;

    const groupings = await q(
      `SELECT t.id, t.name
         FROM public.types t
        WHERE t.property_id = $1
          AND t."group" = 'room-type-grouping'
          AND t.deleted_at IS NULL
        ORDER BY t.sort, t.name`,
      [propertyId],
    );
    const list = wanted.length
      ? groupings.rows.filter((g: any) =>
          wanted.some((w) => w.toLowerCase() === String(g.name).toLowerCase() || w === String(g.id))
        )
      : groupings.rows;

    if (!list.length) {
      return badRequest(
        res,
        'This property has no Room Type Grouping yet',
        'Add groupings in step 3 (Master Data) first, then come back.',
      );
    }

    const results = await inTransaction(async (tx) => {
      const out: any[] = [];
      let seq = 0;
      for (const g of list as any[]) {
        const found = await tx(
          `SELECT id FROM public.room_types
            WHERE property_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL LIMIT 1`,
          [propertyId, g.name],
        );
        let id: bigint;
        let action: string;
        if (found.rows[0]) {
          id = found.rows[0].id;
          action = 'update';
          await tx(
            `UPDATE public.room_types
                SET rate = COALESCE(rate, $2), status = $3, updated_by = $4, updated_at = now()
              WHERE id = $1`,
            [id, rate, status, actor],
          );
        } else {
          action = 'insert';
          const ins = await tx(
            `INSERT INTO public.room_types
                (property_id, name, is_physical, rate, min_rate, sort, status,
                 created_by, created_at, updated_by, updated_at)
             VALUES ($1,$2,true,$3,$3,$4,$5,$6,now(),$6,now())
             RETURNING id`,
            [propertyId, g.name, rate, seq, status, actor],
          );
          id = ins.rows[0].id;
        }
        seq += 1;
        await tx(
          `INSERT INTO public.model_has_types (type_id, model_type, model_id)
           VALUES ($1, 'App\\Models\\RoomType', $2)
           ON CONFLICT DO NOTHING`,
          [g.id, id],
        );
        out.push({ id: Number(id), name: g.name, grouping_id: Number(g.id), action });
      }
      return out;
    });

    const created = results.filter((r: any) => r.action === 'insert').length;
    return success(
      res,
      { property_id: Number(propertyId), created, total: results.length, room_types: results },
      created ? `Created ${created} room type(s)` : 'All room types already existed',
    );
  } catch (e: any) {
    return error(res, e?.message || 'Failed to build room types from groupings');
  }
}

/* ------------------------------------------------------------------ */
/* 3. Clone master data from a reference property                      */
/* ------------------------------------------------------------------ */

const CLONE_SQL: Record<string, string | string[]> = {
  building: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
             SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
               FROM public.types s
              WHERE s.property_id=$1 AND s."group"='building' AND s.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='building'
                                  AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  floor: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='floor' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='floor'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  room_configuration: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='room-configuration' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='room-configuration'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  room_type_grouping: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='room-type-grouping' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='room-type-grouping'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  guest_title: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='guest-title' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='guest-title'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  guest_status: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='guest-status' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='guest-status'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  market_segment: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group" LIKE 'market-segment%' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"=s."group"
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  source: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='source' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='source'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  company_type: `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, s."group", s.name, s.image, s.text, s.description, s.sort, s.status, $3, now(), $3, now()
              FROM public.types s
             WHERE s.property_id=$1 AND s."group"='company-type' AND s.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.types e WHERE e.property_id=$2 AND e."group"='company-type'
                                 AND lower(e.name)=lower(s.name) AND e.deleted_at IS NULL)`,
  code_billing: `INSERT INTO public.code_billings (property_id,name,description,"isPOS",sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, c.name, c.description, c."isPOS", c.sort, c.status, $3, now(), $3, now()
              FROM public.code_billings c
             WHERE c.property_id=$1 AND c.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.code_billings e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(c.name) AND e.deleted_at IS NULL)`,
  code_gl: `INSERT INTO public.code_gls (property_id,name,alias,description,account_uid,groupcode,mastercode,controlname,leveltype,balancetype,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, c.name, c.alias, c.description, c.account_uid, c.groupcode, c.mastercode, c.controlname, c.leveltype, c.balancetype, c.sort, c.status, $3, now(), $3, now()
              FROM public.code_gls c
             WHERE c.property_id=$1 AND c.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.code_gls e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(c.name) AND e.deleted_at IS NULL)`,
  code_post: `INSERT INTO public.code_posts (property_id,type,code_billing_id,code_gl_id,name,uuid,pay_commission,is_pos,local_tax,local_tax_percentage,
                    service_charge,service_charge_percentage,service_charge_include_local_tax,tax,tax_percentage,tax_include_local_tax,
                    sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, c.type,
                   (SELECT e.id FROM public.code_billings e WHERE e.property_id=$2 AND lower(e.name)=lower(b.name) LIMIT 1),
                   (SELECT e.id FROM public.code_gls     e WHERE e.property_id=$2 AND lower(e.name)=lower(g.name) LIMIT 1),
                   c.name, c.uuid, c.pay_commission, c.is_pos, c.local_tax, c.local_tax_percentage,
                   c.service_charge, c.service_charge_percentage, c.service_charge_include_local_tax,
                   c.tax, c.tax_percentage, c.tax_include_local_tax, c.sort, c.status, $3, now(), $3, now()
              FROM public.code_posts c
              LEFT JOIN public.code_billings b ON b.id=c.code_billing_id
              LEFT JOIN public.code_gls     g ON g.id=c.code_gl_id
             WHERE c.property_id=$1 AND c.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.code_posts e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(c.name) AND e.deleted_at IS NULL)`,
  code_item: `INSERT INTO public.code_items (property_id,code_post_id,name,is_online,is_event,description,sales,cost,process_on,calculator,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2,
                   (SELECT e.id FROM public.code_posts e WHERE e.property_id=$2 AND lower(e.name)=lower(p.name) LIMIT 1),
                   c.name, c.is_online, c.is_event, c.description, c.sales, c.cost, c.process_on, c.calculator, c.sort, c.status, $3, now(), $3, now()
              FROM public.code_items c
              LEFT JOIN public.code_posts p ON p.id=c.code_post_id
             WHERE c.property_id=$1 AND c.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.code_items e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(c.name) AND e.deleted_at IS NULL)`,
  payment_method: [`INSERT INTO public.type_payments (property_id,code_post_id,code_billing_id,name,uuid,company_id,pos,front_office,
                    card_no,card_name,voucher,is_company_ar,is_payment_ar,booking_no,surcharge_type,surcharge,
                    sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2,
                   (SELECT e.id FROM public.code_posts e WHERE e.property_id=$2 AND lower(e.name)=lower(p.name) LIMIT 1),
                   (SELECT e.id FROM public.code_billings e WHERE e.property_id=$2 AND lower(e.name)=lower(b.name) LIMIT 1),
                   t.name, t.uuid, t.company_id, t.pos, t.front_office, t.card_no, t.card_name, t.voucher,
                   t.is_company_ar, t.is_payment_ar, t.booking_no, t.surcharge_type, t.surcharge, t.sort, t.status, $3, now(), $3, now()
              FROM public.type_payments t
              LEFT JOIN public.code_posts p ON p.id=t.code_post_id
              LEFT JOIN public.code_billings b ON b.id=t.code_billing_id
             WHERE t.property_id=$1 AND t.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.type_payments e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(t.name) AND e.deleted_at IS NULL)`],

  // Physical room types + their Room Type Grouping link, remapped by name.
  // The link lives in the Type pivot (App\Models\RoomType), which is why this
  // needs a second statement: the tag id differs per property.
  room_type: [
    `INSERT INTO public.room_types (property_id,name,description,specification,is_physical,rate,min_rate,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, r.name, r.description, r.specification, true, r.rate, r.min_rate, r.sort, r.status, $3, now(), $3, now()
              FROM public.room_types r
             WHERE r.property_id=$1 AND r.deleted_at IS NULL AND r.is_physical
               AND NOT EXISTS (SELECT 1 FROM public.room_types e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(r.name) AND e.deleted_at IS NULL)`,
    `INSERT INTO public.model_has_types (type_id,model_type,model_id)
            SELECT DISTINCT tg.id, 'App\\Models\\RoomType', tr.id
              FROM public.model_has_types mh
              JOIN public.types sg        ON sg.id=mh.type_id AND sg."group"='room-type-grouping'
              JOIN public.room_types src  ON src.id=mh.model_id AND src.property_id=$1 AND src.deleted_at IS NULL AND src.is_physical
              JOIN public.room_types tr   ON tr.property_id=$2 AND lower(tr.name)=lower(src.name) AND tr.deleted_at IS NULL
              JOIN public.types tg        ON tg.property_id=$2 AND tg."group"='room-type-grouping'
                                          AND lower(tg.name)=lower(sg.name) AND tg.deleted_at IS NULL
             WHERE btrim(mh.model_type)='App\\Models\\RoomType'
            ON CONFLICT DO NOTHING`,
  ],

  // One room type per Room Type Grouping on the TARGET property. Cloning only
  // brings the grouping LIST across, so without this a fresh property has
  // groupings but zero room types and the Room Generator is unusable.
  room_type_from_grouping: [
    `INSERT INTO public.room_types (property_id,name,is_physical,rate,min_rate,sort,status,created_by,created_at,updated_by,updated_at)
            SELECT $1, g.name, true, 0, 0, ROW_NUMBER() OVER (ORDER BY g.sort, g.name), 1, $2, now(), $2, now()
              FROM public.types g
             WHERE g.property_id=$1 AND g."group"='room-type-grouping' AND g.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.room_types e WHERE e.property_id=$1
                                 AND lower(e.name)=lower(g.name) AND e.deleted_at IS NULL)`,
    `INSERT INTO public.model_has_types (type_id,model_type,model_id)
            SELECT DISTINCT g.id, 'App\\Models\\RoomType', r.id
              FROM public.types g
              JOIN public.room_types r ON r.property_id=g.property_id AND lower(r.name)=lower(g.name) AND r.deleted_at IS NULL
             WHERE g.property_id=$1 AND g."group"='room-type-grouping' AND g.deleted_at IS NULL
            ON CONFLICT DO NOTHING`,
  ],

  // Role + its menu grants. Roles are matched by name so a re-run is a no-op;
  // role_menu_crud / model_has_menus are remapped source role id -> target role id.
  role: [
    `INSERT INTO public.roles (property_id,name,guard_name,display_name,list_dashboard,status,created_by,created_at,updated_by,updated_at)
            SELECT $2, r.name, r.guard_name, r.display_name, r.list_dashboard, r.status, $3, now(), $3, now()
              FROM public.roles r
             WHERE r.property_id=$1 AND r.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.roles e WHERE e.property_id=$2
                                 AND lower(e.name)=lower(r.name) AND e.deleted_at IS NULL)`,
    `INSERT INTO public.role_menu_crud (role_id,menu_id,view,add,edit,delete,transaction_actions,created_at,updated_at)
            SELECT tr.id, c.menu_id, c.view, c.add, c.edit, c.delete, c.transaction_actions, now(), now()
              FROM public.role_menu_crud c
              JOIN public.roles sr ON sr.id=c.role_id
              JOIN public.roles tr ON tr.property_id=$2 AND lower(tr.name)=lower(sr.name) AND tr.deleted_at IS NULL
             WHERE sr.property_id=$1 AND sr.deleted_at IS NULL
            ON CONFLICT DO NOTHING`,
    `INSERT INTO public.model_has_menus (menu_id,model_type,model_id)
            SELECT c.menu_id, 'App\\Models\\Role', tr.id
              FROM public.role_menu_crud c
              JOIN public.roles sr ON sr.id=c.role_id
              JOIN public.roles tr ON tr.property_id=$2 AND lower(tr.name)=lower(sr.name) AND tr.deleted_at IS NULL
             WHERE sr.property_id=$1 AND sr.deleted_at IS NULL
            ON CONFLICT DO NOTHING`,
  ],

  // Report permission per role + the master-report tags linked to it.
  report_permission: [
    `INSERT INTO public.report_permissions (role_id,property_id,status)
            SELECT tr.id, $2, rp.status
              FROM public.report_permissions rp
              JOIN public.roles sr ON sr.id=rp.role_id
              JOIN public.roles tr ON tr.property_id=$2 AND lower(tr.name)=lower(sr.name) AND tr.deleted_at IS NULL
             WHERE sr.property_id=$1 AND sr.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.report_permissions e WHERE e.role_id=tr.id)`,
    // DISTINCT: the legacy import left tab-padded and unpadded copies of
    // model_type, so btrim() would otherwise surface the same tag twice and
    // violate the (type_id, model_id, model_type) primary key.
    `INSERT INTO public.model_has_types (type_id,model_type,model_id)
            SELECT DISTINCT mh.type_id, 'App\\Models\\ReportPermission', nrp.id
              FROM public.model_has_types mh
              JOIN public.report_permissions srp ON srp.id=mh.model_id
              JOIN public.roles sr           ON sr.id=srp.role_id
              JOIN public.roles tr           ON tr.property_id=$2 AND lower(tr.name)=lower(sr.name) AND tr.deleted_at IS NULL
              JOIN public.report_permissions nrp ON nrp.role_id=tr.id
             WHERE sr.property_id=$1 AND sr.deleted_at IS NULL
               AND btrim(mh.model_type)='App\\Models\\ReportPermission'
               AND NOT EXISTS (SELECT 1 FROM public.model_has_types e
                                WHERE btrim(e.model_type)='App\\Models\\ReportPermission'
                                  AND e.model_id=nrp.id AND e.type_id=mh.type_id)`,
  ],
};

export const CLONE_STEPS = Object.keys(CLONE_SQL);

export async function clone(req: Request, res: Response) {
  try {
    const from = BigInt(req.body?.from_property_id);
    const to = BigInt(req.body?.to_property_id);
    if (!from || !to) return badRequest(res, 'from_property_id and to_property_id are required');
    if (from === to) return badRequest(res, 'source and target property must differ');

    const requested: string[] = Array.isArray(req.body?.steps) && req.body.steps.length
      ? req.body.steps.filter((s: string) => CLONE_SQL[s])
      : CLONE_STEPS;
    if (!requested.length) return badRequest(res, 'no valid steps requested');

    const exists = await q(`SELECT id, name FROM public.properties WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`, [[from, to]]);
    if (exists.rows.length < 2) return badRequest(res, 'source or target property not found');

    const actor = actorId(req);

    if (await hasSetupSchema(q)) {
      const r = await q(`SELECT step, inserted FROM "setup"."fn_clone_property_master"($1,$2,$3,$4)`, [
        from, to, requested, actor,
      ]);
      return success(res, { from, to, results: r.rows }, 'Master setup cloned');
    }

    const results = await inTransaction(async (tx) => {
      const out: any[] = [];
      for (const step of requested) {
        // a step can need several statements (role = role + grants + isaccess pivot)
        const list = Array.isArray(CLONE_SQL[step]) ? CLONE_SQL[step] : [CLONE_SQL[step]];
        let inserted = 0;
        for (const sql of list) {
          // pg rejects extra bind params: a statement that only references $1/$2
          // must not receive the third actor param.
          let max = 0;
          for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
          const r = await tx(sql, [from, to, actor].slice(0, max));
          inserted += r.rowCount ?? 0;
        }
        out.push({ step, inserted });
      }
      return out;
    });

    return success(res, { from, to, results }, 'Master setup cloned');
  } catch (e: any) {
    return error(res, e?.message || 'Clone failed');
  }
}

/* ------------------------------------------------------------------ */
/* 4. Bulk upsert tags (buildings, floors, configurators, ...)          */
/* ------------------------------------------------------------------ */

export async function bulkUpsert(req: Request, res: Response) {
  try {
    const propertyId = BigInt(req.body?.property_id ?? req.query.property_id);
    const group = String(req.body?.group ?? '').trim();
    const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!propertyId || !group) return badRequest(res, 'property_id and group are required');
    if (!rows.length) return badRequest(res, 'rows must be a non-empty array');
    if (rows.length > 5000) return badRequest(res, 'max 5000 rows per request');

    const actor = actorId(req);

    if (await hasSetupSchema(q)) {
      const r = await q(`SELECT * FROM "setup"."fn_bulk_upsert_types"($1,$2,$3::jsonb,$4)`, [
        propertyId, group, JSON.stringify(rows), actor,
      ]);
      return success(res, { property_id: propertyId, group, results: r.rows }, 'Bulk upsert applied');
    }

    const results = await inTransaction(async (tx) => {
      const out: any[] = [];
      for (const row of rows) {
        const name = String(row?.name ?? '').trim();
        if (!name) continue;
        const found = await tx(
          `SELECT id FROM public.types
            WHERE property_id=$1 AND "group"=$2 AND lower(name)=lower($3) AND deleted_at IS NULL LIMIT 1`,
          [propertyId, group, name],
        );
        let id: bigint;
        let action: string;
        if (found.rows[0]) {
          id = found.rows[0].id;
          action = 'update';
          await tx(
            `UPDATE public.types SET
               image       = COALESCE($2, image),
               text        = COALESCE($3, text),
               description = COALESCE($4, description),
               sort        = COALESCE($5, sort),
               status      = COALESCE($6, status),
               updated_by  = $7, updated_at = now()
             WHERE id = $1`,
            [id, row.image ?? null, row.text ?? null, row.description ?? null,
             row.sort ?? null, row.status ?? null, actor],
          );
        } else {
          action = 'insert';
          const ins = await tx(
            `INSERT INTO public.types (property_id,"group",name,image,text,description,sort,status,created_by,created_at,updated_by,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0),COALESCE($8,1),$9,now(),$9,now()) RETURNING id`,
            [propertyId, group, name, row.image ?? null, row.text ?? null, row.description ?? null,
             row.sort ?? null, row.status ?? null, actor],
          );
          id = ins.rows[0].id;
        }
        out.push({ tag_id: id, tag_name: name, action });
      }
      return out;
    });

    return success(res, { property_id: propertyId, group, results }, 'Bulk upsert applied');
  } catch (e: any) {
    return error(res, e?.message || 'Bulk upsert failed');
  }
}

/* ------------------------------------------------------------------ */
/* 5. Room generator                                                   */
/* ------------------------------------------------------------------ */

export async function generateRooms(req: Request, res: Response) {
  try {
    const propertyId = BigInt(req.body?.property_id ?? req.query.property_id);
    const roomTypeId = BigInt(req.body?.room_type_id);
    const floorIds: bigint[] = (req.body?.floor_ids ?? []).map((x: any) => BigInt(x));
    const prefix = String(req.body?.prefix ?? '');
    const startNo = Number(req.body?.start_no ?? 1);
    const perFloor = Number(req.body?.count_per_floor ?? 10);
    const maxPax = Number(req.body?.max_pax ?? 2);
    const totalBed = Number(req.body?.total_bed ?? 1);
    const buildingIds: bigint[] = Array.isArray(req.body?.building_ids)
      ? req.body.building_ids.map((x: any) => BigInt(x))
      : [];
    const configIds: bigint[] = Array.isArray(req.body?.room_configuration_ids)
      ? req.body.room_configuration_ids.map((x: any) => BigInt(x))
      : [];

    if (!propertyId || !roomTypeId || !floorIds.length) {
      return badRequest(res, 'property_id, room_type_id and floor_ids are required');
    }
    if (!Number.isFinite(perFloor) || perFloor < 1 || perFloor > 500) {
      return badRequest(res, 'count_per_floor must be between 1 and 500');
    }

    const actor = actorId(req);

    if (await hasSetupSchema(q)) {
      const r = await q(
        `SELECT * FROM "setup"."fn_generate_rooms"($1,$2,$3::bigint[],$4,$5,$6,$7,$8,$9,$10::bigint[],$11::bigint[])`,
        [
          propertyId, roomTypeId, floorIds, prefix, startNo, perFloor, maxPax, totalBed, actor,
          buildingIds.length ? buildingIds : null,
          configIds.length ? configIds : null,
        ],
      );
      return success(res, { total: r.rows.length, rooms: r.rows }, 'Rooms generated');
    }

    const floors = await q(
      `SELECT id, name FROM public.types WHERE id = ANY($1::bigint[]) AND property_id = $2`,
      [floorIds, propertyId],
    );
    if (!floors.rows.length) return badRequest(res, 'no valid floor ids for this property');

    // Same default as the SQL function: every active building of the property.
    const buildings = buildingIds.length
      ? (await q(
          `SELECT id FROM public.types WHERE id = ANY($1::bigint[]) AND property_id = $2 AND "group" = 'building'`,
          [buildingIds, propertyId],
        )).rows
      : (await q(
          `SELECT id FROM public.types WHERE property_id = $1 AND "group" = 'building' AND deleted_at IS NULL`,
          [propertyId],
        )).rows;
    const configs = configIds.length
      ? (await q(
          `SELECT id FROM public.types WHERE id = ANY($1::bigint[]) AND property_id = $2
             AND "group" IN ('room-configuration','in-room-equipment')`,
          [configIds, propertyId],
        )).rows
      : [];

    const results = await inTransaction(async (tx) => {
      const out: any[] = [];
      let floorPos = 0;
      for (const f of floors.rows) {
        floorPos += 1;
        // Floors named "Floor LG" / "Floor G" have no digit; falling back to '0'
        // for all of them made every floor generate the SAME numbers, so the
        // later floors merged into the first one instead of creating rooms.
        const digits = (f.name.match(/[0-9]+/g) ?? []).join('') || String(floorPos);
        for (let i = 0; i < perFloor; i++) {
          const no = `${prefix}${digits.padStart(2, '0')}-${String(startNo + i).padStart(3, '0')}`;
          const existing = await tx(
            `SELECT id FROM public.rooms WHERE property_id=$1 AND name=$2 LIMIT 1`,
            [propertyId, no],
          );
          const roomId: bigint = existing.rows[0]
            ? existing.rows[0].id
            : (
                await tx(
                  `INSERT INTO public.rooms (property_id, room_type_id, name, address_code, max_pax, total_bed,
                                             room_status, maid_status, sort, status, created_by, created_at, updated_by, updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,0,1,0,1,$7,now(),$7,now()) RETURNING id`,
                  [propertyId, roomTypeId, no, f.name, maxPax, totalBed, actor],
                )
              ).rows[0].id;

          if (!existing.rows[0]) out.push({ room_number: no, room_id: Number(roomId), created: true });
          else out.push({ room_number: no, room_id: Number(roomId), created: false });

          // Room Setup reads Floor / Building / Room Configuration from the Type
          // pivot (model_has_types, App\Models\Room) - see Room::formatData().
          const tagIds = [f.id, ...buildings.map((b: any) => b.id), ...configs.map((c: any) => c.id)];
          for (const tid of tagIds) {
            await tx(
              `INSERT INTO public.model_has_types (type_id, model_type, model_id)
               VALUES ($1, 'App\\Models\\Room', $2) ON CONFLICT DO NOTHING`,
              [tid, roomId],
            );
          }
        }
      }
      return out;
    });

    return success(
      res,
      { total: results.length, created: results.filter((x: any) => x.created).length, rooms: results },
      'Rooms generated',
    );
  } catch (e: any) {
    return error(res, e?.message || 'Room generation failed');
  }
}

/* ------------------------------------------------------------------ */
/* 6. Templates + scripts (optimized DB only)                          */
/* ------------------------------------------------------------------ */

export async function templates(req: Request, res: Response) {
  try {
    if (!(await hasSetupSchema(q))) {
      return success(res, [], 'Templates (optimized database not deployed)');
    }
    const list = await q(
      `SELECT t.id, t.key, t.label, t.description, t.source_property_id, t.is_builtin, t.is_active,
              p.name AS source_property_name,
              (SELECT count(*) FROM "setup"."template_item" i WHERE i.template_id = t.id) AS item_count
         FROM "setup"."template" t
         LEFT JOIN public.properties p ON p.id = t.source_property_id
        WHERE t.is_active ORDER BY t.is_builtin DESC, t.id`,
    );
    const rawId = req.query?.id;
    const id = rawId != null && String(rawId).trim() !== '' ? BigInt(String(rawId)) : null;
    if (!id) return success(res, list.rows, 'Templates');

    const items = await q(
      `SELECT id, step, entity, action, seq, natural_key, payload, is_enabled
         FROM "setup"."template_item" WHERE template_id = $1 ORDER BY seq`,
      [id],
    );
    return success(res, { ...list.rows[0], items: items.rows }, 'Template detail');
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load templates');
  }
}

export async function scripts(req: Request, res: Response) {
  try {
    if (!(await hasSetupSchema(q))) {
      return success(res, [], 'Scripts (optimized database not deployed)');
    }
    const r = await q(
      `SELECT id, key, label, description, step, language, body, param_schema, is_destructive, is_active
         FROM "setup"."script" WHERE is_active ORDER BY id`,
    );
    return success(res, r.rows, 'Setup scripts');
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load scripts');
  }
}

/**
 * Run a saved script. SQL scripts are read-only by default: anything that is
 * not a SELECT is rejected unless the script itself is flagged destructive and
 * the caller explicitly passes confirm=true.
 */
export async function runScript(req: Request, res: Response) {
  try {
    if (!(await hasSetupSchema(q))) return badRequest(res, 'Script runner requires the optimized database');

    const id = BigInt(String(req.params.id));
    const script = await q(
      `SELECT * FROM "setup"."script" WHERE id = $1 AND is_active`,
      [id],
    );
    const s = script.rows[0];
    if (!s) return notFound(res, 'Script not found');

    const params: Record<string, any> = req.body?.params ?? {};
    const sql = String(s.body);
    const destructive = /^\s*(insert|update|delete|alter|drop|truncate|create)\b/i.test(sql);

    if (destructive && s.is_destructive && req.body?.confirm !== true) {
      return badRequest(res, 'This script changes data. Re-send with confirm=true.');
    }

    const started = await q(
      `INSERT INTO "setup"."script_run" (script_id, property_id, params, status, executed_by, executed_at)
       VALUES ($1,$2,$3,'running',$4,now()) RETURNING id`,
      [id, req.body?.property_id ?? null, JSON.stringify(params), actorId(req)],
    );
    const runId = started.rows[0].id;

    try {
      let result: any;
      if (s.language === 'sql') {
        let bound = sql;
        const values: any[] = [];
        for (const [k, v] of Object.entries(params)) {
          const token = new RegExp(`:${k}\\b`, 'g');
          let m;
          while ((m = token.exec(bound)) !== null) {
            values.push(v);
            bound = bound.replace(m[0], `$${values.length}`);
          }
        }
        result = (await q(bound, values)).rows;
      } else {
        result = { note: 'JSON scripts are executed by the wizard UI, not the API' };
      }
      await q(
        `UPDATE "setup"."script_run" SET status='done', result=$2 WHERE id=$1`,
        [runId, JSON.stringify(result ?? null)],
      );
      return success(res, { run_id: runId, result }, 'Script executed');
    } catch (e: any) {
      await q(
        `UPDATE "setup"."script_run" SET status='failed', error=$2 WHERE id=$1`,
        [runId, String(e?.message ?? e)],
      );
      throw e;
    }
  } catch (e: any) {
    return error(res, e?.message || 'Script execution failed');
  }
}

/* ------------------------------------------------------------------ */
/* 7. Audit trail (optimized DB only)                                  */
/* ------------------------------------------------------------------ */

export async function audit(req: Request, res: Response) {
  try {
    if (!(await hasSetupSchema(q))) {
      return success(res, [], 'Change log (optimized database not deployed)');
    }
    const table = req.query?.table ? String(req.query.table) : null;
    const propertyId = resolvePropertyId(req);
    const limit = Math.min(Number(req.query?.limit ?? 100), 500);

    const params: any[] = [];
    const where: string[] = [];
    if (table) {
      params.push(table);
      where.push(`c.table_name = $${params.length}`);
    }
    if (propertyId) {
      params.push(propertyId);
      where.push(
        `(COALESCE((c.new_data->>'property_id')::bigint, (c.old_data->>'property_id')::bigint) = $${params.length}` +
        ` OR c.table_name = 'properties' AND COALESCE((c.old_data->>'id')::bigint, (c.new_data->>'id')::bigint) = $${params.length})`,
      );
    }
    params.push(limit);

    const r = await q(
      `SELECT c.id, c.table_name, c.row_id, c.op, c.changed_at,
              u.username AS actor
         FROM audit.change_log c
         LEFT JOIN public.users u ON u.id = c.actor_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.changed_at DESC, c.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return success(res, r.rows, 'Change log');
  } catch (e: any) {
    return error(res, e?.message || 'Failed to load change log');
  }
}

/** Drop the cached "does the setup schema exist" probe (used after migrations). */
export async function refreshSchemaCache(_req: Request, res: Response) {
  await resetSetupSchemaCache();
  const on = await hasSetupSchema(q);
  return success(res, { advanced_schema: on }, 'Schema cache refreshed');
}
