import { Request, Response } from 'express';
import {
  bookingExecute,
  bookingQuery,
  isBookingDbConfigured,
  likePattern,
} from '../services/booking-db.service';
import { badRequest, error, notFound, success } from '../utils/response';
import { crudPermission, laravelPaging, listPermission, STATUS_OPTIONS } from '../utils/tableMeta';

// Laravel parity for the three guest-loyalty resources of Booking Engine Setup:
//   App\Http\Controllers\Cms\Hotel\LoyaltyRewardController         (cms.php:1434)
//   App\Http\Controllers\Cms\Hotel\RewardRedemptionController      (cms.php:1435)
//   App\Http\Controllers\Cms\Hotel\GuestPointTransactionController (cms.php:1436)
//
// All three models sit on the `hmsbooking` MySQL connection, i.e. inside the
// BOOKING ENGINE database, so these handlers talk to MySQL directly instead of the
// usual Postgres prisma client. The booking engine reads the same rows:
//   RewardController@rewards -> LoyaltyReward + GuestPointTransaction + RewardRedemption
//   RewardController@redeem  -> writes RewardRedemption + GuestPointTransaction
//
// Write rules copied from the reference, they are part of the contract:
//   RewardRedemption.store      -> 400 "Redemption is created via the booking engine portal."
//   RewardRedemption.destroy    -> 400 "Redemptions cannot be deleted."
//   RewardRedemption.update     -> status only, validated against config('cms.reward_status')
//   GuestPointTransaction.*     -> read-only, 400 on every write

// Menu ids fixed by sql/2026-10-03_booking_engine_setup_missing_menus.sql
const MENU_LOYALTY_REWARD = 1192n;
const MENU_REWARD_REDEMPTION = 1193n;
const MENU_GUEST_POINT_TRANSACTION = 1194n;

// config('cms.reward_status')
const REWARD_STATUS = [
  { value: 1, label: 'Pending', color: 'yellow', status: false },
  { value: 2, label: 'Issued', color: 'green', status: true },
  { value: 3, label: 'Rejected', color: 'red', status: false },
  { value: 4, label: 'Canceled', color: 'gray', status: false },
];

// config('cms.point_type')
const POINT_TYPE = [
  { value: 'earning', label: 'Earning' },
  { value: 'redeem', label: 'Redeem' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'expired', label: 'Expired' },
];

function paging(query: any) {
  return {
    page: parseInt(query.page as string) || 1,
    limit: Math.min(parseInt(query.limit as string) || 10, 100),
    search: (query.search as string) || '',
  };
}

function sortClause(query: any, allowed: string[], fallback: string): string {
  const requested = String(query.sort ?? '').trim();
  const column = allowed.includes(requested) ? requested : fallback;
  const direction = String(query.order ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `order by ${column} ${direction}`;
}

function idParam(value: any): number | null {
  const s = String(value ?? '');
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** 503 when the booking engine database is not reachable/configured. */
function dbGuard(res: Response): boolean {
  if (isBookingDbConfigured()) return true;
  error(res, 'Booking Engine database is not configured (DB_HMSBOOK_*)', 503);
  return false;
}

export class LoyaltyController {
  // ── Loyalty Reward (loyalty_rewards) — full CRUD, the guest portal reads it ──
  static async rewardList(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const { page, limit, search } = paging(req.query);
      const propertyId = String(req.user?.lastProperty ?? 0);
      const offset = (page - 1) * limit;
      const pattern = search ? likePattern(search) : null;

      const where = pattern
        ? 'where lr.property_id = ? and lr.deleted_at is null and (lr.name like ? or lr.description like ?)'
        : 'where lr.property_id = ? and lr.deleted_at is null';
      const params: any[] = pattern ? [propertyId, pattern, pattern] : [propertyId];

      const rows = await bookingQuery(
        `select lr.*, p.name as property_name
           from loyalty_rewards lr
           left join properties p on p.id = lr.property_id
           ${where}
           ${sortClause(req.query, ['name', 'points_cost', 'stock', 'sort', 'status', 'created_at'], 'created_at')}
           limit ? offset ?`,
        [...params, limit, offset]
      );
      const totalRows = await bookingQuery<any>(`select count(*) as total from loyalty_rewards lr ${where}`, params);
      const total = Number(totalRows[0]?.total ?? 0);

      success(res, rows, 'Success', 200, {
        table: [
          { label: 'Status', key: 'status', type: 'checkbox', options: STATUS_OPTIONS, is_search: true },
          { label: 'Reward Name', key: 'name', type: 'text', is_search: true },
          { label: 'Description', key: 'description', type: 'textarea', is_html: true, is_search: false },
          { label: 'Points Cost', key: 'points_cost', type: 'number', is_search: false },
          { label: 'Image', key: 'image', type: 'text', is_search: false },
          { label: 'Stock', key: 'stock', type: 'number', is_search: false },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: listPermission(req, crudPermission(req.user, MENU_LOYALTY_REWARD)),
        pagging: laravelPaging(total, limit, page),
        master: { statuses: STATUS_OPTIONS },
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
      console.error('Loyalty reward list error:', err);
      error(res, 'Failed to list rewards', 500);
    }
  }

  static async rewardForm(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const master = { statuses: STATUS_OPTIONS, properties: await propertyOptions() };

      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master });
        return;
      }
      const rows = await bookingQuery('select * from loyalty_rewards where id = ? and deleted_at is null', [id]);
      if (!rows.length) { notFound(res, 'Reward not found'); return; }
      success(res, rows[0], 'Success', 200, { master });
    } catch (err: any) {
      console.error('Loyalty reward form error:', err);
      error(res, 'Failed to load reward', 500);
    }
  }

  static async rewardStore(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const { property_id, name, description, points_cost, image, stock, sort, status } = req.body ?? {};
      const errors: string[] = [];
      if (!name) errors.push('The name field is required.');
      if (points_cost === undefined || points_cost === null || points_cost === '') {
        errors.push('The points cost field is required.');
      } else if (!Number.isInteger(Number(points_cost)) || Number(points_cost) < 0) {
        errors.push('The points cost must be an integer.');
      }
      if (stock !== undefined && stock !== null && stock !== '' && Number(stock) < 0) {
        errors.push('The stock must be an integer.');
      }
      if (errors.length) { badRequest(res, errors[0]); return; }

      const pid = property_id ?? req.user?.lastProperty ?? 0;
      const result: any = await bookingExecute(
        `insert into loyalty_rewards
           (property_id, name, description, points_cost, image, stock, sort, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
        [
          String(pid),
          String(name),
          description ?? null,
          Number(points_cost),
          image ?? null,
          stock === undefined || stock === null || stock === '' ? null : Number(stock),
          Number(sort ?? 0),
          Number(status ?? 1),
        ]
      );
      const rows = await bookingQuery('select * from loyalty_rewards where id = ?', [result.insertId]);
      success(res, rows[0] ?? { id: result.insertId }, 'Reward created successfully.', 200);
    } catch (err: any) {
      console.error('Loyalty reward store error:', err);
      error(res, 'Failed to create reward', 500);
    }
  }

  static async rewardUpdate(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }

      const { property_id, name, description, points_cost, image, stock, sort, status } = req.body ?? {};
      const errors: string[] = [];
      if (name !== undefined && !name) errors.push('The name field is required.');
      if (points_cost !== undefined && (!Number.isInteger(Number(points_cost)) || Number(points_cost) < 0)) {
        errors.push('The points cost must be an integer.');
      }
      if (errors.length) { badRequest(res, errors[0]); return; }

      const existing = await bookingQuery('select id from loyalty_rewards where id = ? and deleted_at is null', [id]);
      if (!existing.length) { notFound(res, 'Reward not found'); return; }

      // The reference filters out null values before updating, so an absent field
      // never wipes a stored column.
      const sets: string[] = [];
      const params: any[] = [];
      const push = (col: string, val: any) => {
        sets.push(`${col} = ?`);
        params.push(val);
      };
      if (property_id !== undefined && property_id !== null) push('property_id', String(property_id));
      if (name !== undefined && name !== null) push('name', String(name));
      if (description !== undefined && description !== null) push('description', description);
      if (points_cost !== undefined && points_cost !== null) push('points_cost', Number(points_cost));
      if (image !== undefined && image !== null) push('image', image);
      if (stock !== undefined && stock !== null) push('stock', Number(stock));
      if (sort !== undefined && sort !== null) push('sort', Number(sort));
      if (status !== undefined && status !== null) push('status', Number(status));
      if (!sets.length) {
        const unchanged = await bookingQuery('select * from loyalty_rewards where id = ?', [id]);
        success(res, unchanged[0], 'Reward updated successfully.');
        return;
      }
      sets.push('updated_at = now()');
      await bookingExecute(`update loyalty_rewards set ${sets.join(', ')} where id = ?`, [...params, id]);

      const rows = await bookingQuery('select * from loyalty_rewards where id = ?', [id]);
      success(res, rows[0], 'Reward updated successfully.');
    } catch (err: any) {
      console.error('Loyalty reward update error:', err);
      error(res, 'Failed to update reward', 500);
    }
  }

  static async rewardDestroy(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const result: any = await bookingExecute('delete from loyalty_rewards where id = ? and deleted_at is null', [id]);
      if (!result.affectedRows) { notFound(res, 'Reward not found'); return; }
      success(res, [], 'Reward deleted successfully.');
    } catch (err: any) {
      console.error('Loyalty reward destroy error:', err);
      error(res, 'Failed to delete reward', 500);
    }
  }

  // ── Reward Redemption (reward_redemptions) — view + status only ────────────
  static async redemptionList(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const { page, limit, search } = paging(req.query);
      const propertyId = String(req.user?.lastProperty ?? 0);
      const offset = (page - 1) * limit;
      const pattern = search ? likePattern(search) : null;

      const where = pattern
        ? `where rr.property_id = ? and (rr.redeem_code like ? or rr.reward_name like ? or u.name like ?)`
        : 'where rr.property_id = ?';
      const params: any[] = pattern
        ? [propertyId, pattern, pattern, pattern]
        : [propertyId];

      const rows = await bookingQuery(
        `select rr.*, u.name as user_name, u.email as user_email, p.name as property_name
           from reward_redemptions rr
           left join users u on u.id = rr.user_id
           left join properties p on p.id = rr.property_id
           ${where}
           ${sortClause(req.query, ['redeem_code', 'reward_name', 'points_spent', 'qty', 'status', 'created_at'], 'created_at')}
           limit ? offset ?`,
        [...params, limit, offset]
      );
      const totalRows = await bookingQuery<any>(
        `select count(*) as total from reward_redemptions rr left join users u on u.id = rr.user_id ${where}`,
        params
      );
      const total = Number(totalRows[0]?.total ?? 0);

      // Reference: add = false, delete = false.
      success(res, rows, 'Success', 200, {
        table: [
          { label: 'Status', key: 'status', type: 'select', options: REWARD_STATUS, is_search: true },
          { label: 'Redeem Code', key: 'redeem_code', type: 'text', is_search: true },
          { label: 'Guest', key: 'guest', type: 'text', is_search: true },
          { label: 'Property', key: 'property_name', type: 'text', is_search: true },
          { label: 'Reward', key: 'reward_name', type: 'text', is_search: true },
          { label: 'Points', key: 'points_spent', type: 'number', is_search: false },
          { label: 'Qty', key: 'qty', type: 'number', is_search: false },
        ],
        permission: listPermission(req, { add: false, edit: crudPermission(req.user, MENU_REWARD_REDEMPTION).edit, delete: false }),
        pagging: laravelPaging(total, limit, page),
        master: { statuses: REWARD_STATUS },
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
      console.error('Reward redemption list error:', err);
      error(res, 'Failed to list redemptions', 500);
    }
  }

  static async redemptionCreate(_req: Request, res: Response): Promise<void> {
    badRequest(res, 'Redemption is created via the booking engine portal.');
  }

  static async redemptionShow(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const rows = await bookingQuery(
        `select rr.*, u.name as user_name, u.email as user_email, p.name as property_name
           from reward_redemptions rr
           left join users u on u.id = rr.user_id
           left join properties p on p.id = rr.property_id
          where rr.id = ?`,
        [id]
      );
      if (!rows.length) { notFound(res, 'Redemption not found'); return; }
      success(res, rows[0], 'Success', 200);
    } catch (err: any) {
      console.error('Reward redemption show error:', err);
      error(res, 'Failed to load redemption', 500);
    }
  }

  static async redemptionEdit(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const rows = await bookingQuery(
        `select rr.*, u.name as user_name, u.email as user_email
           from reward_redemptions rr
           left join users u on u.id = rr.user_id
          where rr.id = ?`,
        [id]
      );
      if (!rows.length) { notFound(res, 'Redemption not found'); return; }
      success(res, rows[0], 'Success', 200, { master: { statuses: REWARD_STATUS } });
    } catch (err: any) {
      console.error('Reward redemption edit error:', err);
      error(res, 'Failed to load redemption', 500);
    }
  }

  static async redemptionUpdate(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const status = (req.body ?? {}).status;
      if (status === undefined || status === null || status === '') {
        badRequest(res, 'The status field is required.');
        return;
      }
      if (!REWARD_STATUS.some((s) => s.value === Number(status))) {
        badRequest(res, 'Invalid reward status.');
        return;
      }
      const existing = await bookingQuery('select id from reward_redemptions where id = ?', [id]);
      if (!existing.length) { notFound(res, 'Redemption not found'); return; }
      await bookingExecute('update reward_redemptions set status = ?, updated_at = now() where id = ?', [
        Number(status),
        id,
      ]);
      success(res, null, 'Redemption status updated successfully.');
    } catch (err: any) {
      console.error('Reward redemption update error:', err);
      error(res, 'Failed to update redemption', 500);
    }
  }

  static async redemptionDestroy(_req: Request, res: Response): Promise<void> {
    badRequest(res, 'Redemptions cannot be deleted.');
  }

  // ── Guest Point Transaction (guest_point_transactions) — read-only ─────────
  static async pointList(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const { page, limit, search } = paging(req.query);
      const propertyId = String(req.user?.lastProperty ?? 0);
      const offset = (page - 1) * limit;
      const pattern = search ? likePattern(search) : null;

      const where = pattern
        ? 'where gpt.property_id = ? and (gpt.note like ? or u.name like ?)'
        : 'where gpt.property_id = ?';
      const params: any[] = pattern ? [propertyId, pattern, pattern] : [propertyId];

      const rows = await bookingQuery(
        `select gpt.*, u.name as user_name, u.email as user_email, p.name as property_name
           from guest_point_transactions gpt
           left join users u on u.id = gpt.user_id
           left join properties p on p.id = gpt.property_id
           ${where}
           ${sortClause(req.query, ['type', 'points', 'balance_after', 'created_at'], 'created_at')}
           limit ? offset ?`,
        [...params, limit, offset]
      );
      const totalRows = await bookingQuery<any>(
        `select count(*) as total from guest_point_transactions gpt left join users u on u.id = gpt.user_id ${where}`,
        params
      );
      const total = Number(totalRows[0]?.total ?? 0);

      success(res, rows, 'Success', 200, {
        table: [
          { label: 'Type', key: 'type', type: 'select', options: POINT_TYPE, is_search: true },
          { label: 'Guest', key: 'user_name', type: 'text', is_search: true },
          { label: 'Property', key: 'property_name', type: 'text', is_search: true },
          { label: 'Points', key: 'points', type: 'number', is_search: false },
          { label: 'Balance After', key: 'balance_after', type: 'number', is_search: false },
          { label: 'Note', key: 'note', type: 'text', is_search: true },
        ],
        permission: listPermission(req, { add: false, edit: false, delete: false }),
        pagging: laravelPaging(total, limit, page),
        master: { types: POINT_TYPE },
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
      console.error('Guest point transaction list error:', err);
      error(res, 'Failed to list point transactions', 500);
    }
  }

  static async pointCreate(_req: Request, res: Response): Promise<void> {
    badRequest(res, 'Point transactions are created automatically from bookings.');
  }

  static async pointShow(req: Request, res: Response): Promise<void> {
    try {
      if (!dbGuard(res)) return;
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const rows = await bookingQuery(
        `select gpt.*, u.name as user_name, u.email as user_email, p.name as property_name
           from guest_point_transactions gpt
           left join users u on u.id = gpt.user_id
           left join properties p on p.id = gpt.property_id
          where gpt.id = ?`,
        [id]
      );
      if (!rows.length) { notFound(res, 'Point transaction not found'); return; }
      success(res, rows[0], 'Success', 200);
    } catch (err: any) {
      console.error('Guest point transaction show error:', err);
      error(res, 'Failed to load point transaction', 500);
    }
  }

  static async pointUpdate(_req: Request, res: Response): Promise<void> {
    badRequest(res, 'Point transactions are read-only.');
  }

  static async pointDestroy(_req: Request, res: Response): Promise<void> {
    badRequest(res, 'Point transactions are read-only.');
  }
}

async function propertyOptions(): Promise<{ value: number; label: string }[]> {
  const rows = await bookingQuery<any>('select id, name from properties order by name');
  return rows.map((r) => ({ value: Number(r.id), label: r.name }));
}