import { Request, Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { moneyFormat } from '../utils/cmsConfig';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_RESERVATION = { check_in: 0, check_out: 1, cancel_reservation: 2, reservation: 3, in_house: 4, pending: 5 };
const STATUS_ACTIVE = 1;

function toNum(v: any): any {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(toNum);
  if (v && typeof v === 'object' && typeof (v as any).toNumber === 'function') return Number((v as any).toNumber());
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = toNum(v[k]);
    return o;
  }
  return v;
}

function dayAfter(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  return x;
}

function money(value: any, decimal = 2, mode: 'half_up' | 'truncate' = 'half_up'): number {
  const float = Number(value ?? 0);
  const multiplier = Math.pow(10, decimal);
  if (mode === 'truncate') return Math.trunc(float * multiplier) / multiplier;
  return Math.round(float * multiplier) / multiplier;
}

/**
 * POS mobile API (Laravel MiddlewareController parity, web.php /pos/*).
 * Public token-less (client_uid based).
 */
export class PosMobileController {
  // GET /map (Laravel MapsController@index parity — Blade view with Leaflet markers)
  static async mapIndex(req: Request, res: Response): Promise<void> {
    try {
      const token = req.query.token as string | undefined;
      if (!token) { res.status(400).json({ message: 'Token is required.' }); return; }

      // Sanctum parity: "id|plainText", stored token = sha256(plainText)
      const [idStr, plain] = token.split('|');
      const hashed = createHash('sha256').update(plain ?? '').digest('hex');
      const pat = await prisma.personal_access_tokens.findFirst({
        where: { id: BigInt(Number(idStr)), token: hashed },
      });
      if (!pat) { res.status(404).json({ message: 'Token not found.' }); return; }

      const user = await prisma.users.findUnique({ where: { id: pat.tokenable_id } });
      const property = user?.last_property ? await prisma.properties.findUnique({ where: { id: user.last_property } }) : null;
      if (!property) { res.status(404).json({ message: 'No data found.' }); return; }

      const logAudit = await prisma.log_audits.findFirst({
        where: { property_id: Number(property.id) },
        orderBy: { date: 'desc' },
      });
      const date = logAudit ? new Date(new Date(logAudit.date).getTime() + 24 * 60 * 60 * 1000) : new Date();
      const start = new Date(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T00:00:00`);
      const dayRange = { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };

      const db = await prisma.hotel_competitors.findMany({ where: { date: dayRange, property_id: property.id } });
      const master = await prisma.master_hotel_competitors.findMany({
        where: { property_id: property.id, status: 1, deleted_at: null },
      });

      const reservationAgg = await prisma.reservations.aggregate({
        _sum: { amount: true },
        where: { property_id: property.id, date: dayRange, folios: { is: { status_reservation: { not: 2 } } } },
      });
      const reservation = Number(reservationAgg._sum.amount ?? 0);

      const roomAvailable = await prisma.rooms.count({ where: { property_id: property.id, status: 1, deleted_at: null } });
      const roomSold = await prisma.rooms.count({
        where: { property_id: property.id, status: 1, deleted_at: null, room_status: { in: [1, 2] } },
      });

      const ownRevenue = roomSold * (reservation / (roomSold < 1 ? 1 : roomSold));
      const data: any[] = [{
        id: 0,
        name: property.name,
        room_revenue: ownRevenue,
        longitude: property.longitude,
        latitude: property.latitude,
      }];

      for (let i = 0; i < master.length; i++) {
        const m = master[i];
        const hc = db.find((d) => d.master_hotel_competitor_id === m.id);
        if (hc) {
          data[i + 1] = {
            id: Number(m.id),
            name: m.name,
            latitude: m.latitude,
            longitude: m.longitude,
            room_revenue: Number(hc.room_sold) * Number(hc.arr),
            room_available: hc.room_available,
            room_sold: hc.room_sold,
            arr: Number(hc.arr),
            total_revenue: Number(hc.total_revenue),
          };
        } else {
          data[i + 1] = {
            id: Number(m.id),
            name: m.name,
            room_revenue: 0,
            latitude: m.latitude,
            longitude: m.longitude,
          };
        }
      }

      const localResults = data
        .filter((item) => item.latitude && item.longitude)
        .map((item) => ({
          title: item.name,
          price: moneyFormat(item.room_revenue),
          gps_coordinates: { latitude: item.latitude, longitude: item.longitude },
        }));

      const markers = localResults.map((h: any) => {
        const title = String(h.title).length > 10 ? String(h.title).slice(0, 7) + '...' : String(h.title);
        return `addHotelMarker(${h.gps_coordinates.latitude}, ${h.gps_coordinates.longitude}, '${title.replace(/'/g, "\\'")}', '${h.price}');`;
      }).join('\n            ');

      const lat = property.latitude ?? '';
      const lng = property.longitude ?? '';

      res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>Maps</title>
</head>
<body>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css"></link>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <div id="map" style="height: 100vh;"></div>

    <script>
        var map = L.map('map').setView(["${lat}", "${lng}"], 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
        }).addTo(map);

        function addHotelMarker(lat, lng, name, price) {
            L.tooltip({
                permanent: true,
                direction: 'top',
                opacity: 1,
                size: [200, 100],
            })
            .setLatLng([lat, lng])
            .setContent(
                '<div style="width: auto; height: auto; background-color: #fff; align-items: center; gap:1px; padding:0; text-align: center">' +
                '<i class="fas fa-hotel"></i>' +
                '<div style="display: flex; flex-direction: column; gap: 1px;">' +
                '<span style="font-weight: bold; font-size: 14px;">' + name + '</span>' +
                '<span style="font-size: 12px;">Room Rev: ' + price + '</span>' +
                '</div>'
                + '</div>'
            )
            .addTo(map);
        }

        ${markers}
    </script>
    
</body>
</html>`);
    } catch (err: any) {
      console.error('Map index error:', err);
      res.status(500).json({ message: 'Failed to load map' });
    }
  }

  // ── POST /pos/type-payment ──
  static async typePayment(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid } = req.body;
      if (!client_uid) { badRequest(res, 'The client uid field is required.'); return; }
      const property = await prisma.properties.findFirst({ where: { client_uid }, orderBy: { id: 'asc' } });
      if (!property) { notFound(res, 'Property not found.'); return; }

      const codePosts = await prisma.code_posts.findMany({
        where: { property_id: property.id, is_pos: 1, status: STATUS_ACTIVE },
        include: { type_payments: true },
      });

      const typePayment: any[] = [];
      for (const cp of codePosts) {
        for (const item of cp.type_payments) {
          let uuid = item.uuid;
          if (!uuid) {
            uuid = randomUUID();
            await prisma.type_payments.update({ where: { id: item.id }, data: { uuid } });
          }
          typePayment.push({
            uuid,
            name: item.name,
            surcharge_type: item.surcharge_type === 0 ? 'Percentage' : 'Amount',
            surcharge: toNum(item.surcharge),
          });
        }
      }

      success(res, { data: typePayment }, 'Success');
    } catch (err: any) {
      console.error('typePayment error:', err);
      error(res, 'Failed to load payment types', 500);
    }
  }

  // ── POST /pos/post-code ──
  static async postCode(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid } = req.body;
      if (!client_uid) { badRequest(res, 'The client uid field is required.'); return; }
      const property = await prisma.properties.findFirst({ where: { client_uid }, orderBy: { id: 'asc' } });
      if (!property) { notFound(res, 'Property not found.'); return; }

      const codePosts = await prisma.code_posts.findMany({
        where: { property_id: property.id, is_pos: 1, status: STATUS_ACTIVE },
      });

      const postCode: any[] = [];
      for (const item of codePosts) {
        let uuid = item.uuid;
        if (!uuid) {
          uuid = randomUUID();
          await prisma.code_posts.update({ where: { id: item.id }, data: { uuid } });
        }
        postCode.push({
          uuid,
          name: item.name,
          is_local_tax: !!item.local_tax,
          local_tax_percentage: toNum(item.local_tax_percentage),
          is_service_charge: !!item.service_charge,
          service_charge_percentage: toNum(item.service_charge_percentage),
          is_service_charge_include_local_tax: !!item.service_charge_include_local_tax,
          is_tax3: !!item.tax,
          tax3_percentage: toNum(item.tax_percentage),
          is_tax3_include_local_tax: !!item.tax_include_local_tax,
        });
      }

      success(res, { data: postCode }, 'Success');
    } catch (err: any) {
      console.error('postCode error:', err);
      error(res, 'Failed to load post codes', 500);
    }
  }

  // ── POST /pos/get-deposit ──
  static async getDeposit(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid, folio_number, room_number } = req.body;
      if (!client_uid) { badRequest(res, 'The client uid field is required.'); return; }
      const property = await prisma.properties.findFirst({ where: { client_uid }, orderBy: { id: 'asc' } });
      if (!property) { notFound(res, 'Client not found.'); return; }

      let folio: any = null;
      if (folio_number) {
        folio = await prisma.folios.findFirst({
          where: { property_id: property.id, folio_number: String(folio_number).toUpperCase() },
          include: { transactions: true },
        });
        if (!folio) { notFound(res, 'Reservation not found.'); return; }
      } else {
        if (!room_number) { badRequest(res, 'The room number field is required.'); return; }
        const room = await prisma.rooms.findFirst({
          where: { property_id: property.id, name: room_number },
        });
        if (!room) { notFound(res, 'Room not found.'); return; }
        const reservation = await prisma.reservations.findFirst({
          where: {
            room_id: room.id,
            folios: { status_reservation: STATUS_RESERVATION.check_in },
          },
          orderBy: { date: 'asc' },
          include: { folios: { include: { transactions: true } } },
        });
        if (!reservation?.folios) { notFound(res, 'Reservation not found.'); return; }
        folio = reservation.folios;
      }

      const deposit = (folio.transactions ?? [])
        .filter((t: any) => t.type === 'payment' && t.is_pos_deposit === 1)
        .map((t: any) => ({
          uuid: t.uuid,
          date: t.date,
          code_name: t.code_name,
          amount: toNum(t.amount),
          surcharge: toNum(t.surcharge),
        }));

      success(res, { data: deposit }, 'Success');
    } catch (err: any) {
      console.error('getDeposit error:', err);
      error(res, 'Failed to load deposit', 500);
    }
  }

  // ── POST /pos/get-folio ──
  static async getFolio(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid, folio_number } = req.body;
      if (!client_uid) { badRequest(res, 'The client uid field is required.'); return; }
      if (!folio_number) { badRequest(res, 'The folio number field is required.'); return; }
      const property = await prisma.properties.findFirst({ where: { client_uid }, orderBy: { id: 'asc' } });
      if (!property) { notFound(res, 'Client not found.'); return; }

      const folio = await prisma.folios.findFirst({
        where: { property_id: property.id, folio_number: String(folio_number).toUpperCase() },
        include: { company_profiles_folios_company_profile_idTocompany_profiles: true },
      });
      if (!folio) { notFound(res, 'Reservation not found.'); return; }

      const lastReservation = await prisma.reservations.findFirst({
        where: { folio_id: folio.id },
        orderBy: { date: 'desc' },
      });

      let current = '';
      if (lastReservation?.room_id) {
        const room = await prisma.rooms.findUnique({ where: { id: lastReservation.room_id } });
        if (lastReservation.room_id === lastReservation.room_id_next) {
          const yesterday = await prisma.reservations.findFirst({
            where: { folio_id: folio.id, date: dayAfter(new Date(lastReservation.date)) },
          });
          if (yesterday?.room_id) {
            const yesterdayRoom = await prisma.rooms.findUnique({ where: { id: yesterday.room_id } });
            current = yesterdayRoom?.name ?? room?.name ?? '';
          } else {
            current = room?.name ?? '';
          }
        } else {
          current = room?.name ?? '';
        }
      }

      const guestProfile = folio.guest_profile_id
        ? await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } })
        : null;

      // Laravel Folio::getStatusGuest parity
      let guestStatus: { value: number; label: string } = { value: 1, label: 'Normal' };
      const folioTypes = await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Folio', model_id: folio.id },
        include: { types: true },
      });
      const gs = folioTypes.find((x) => x.types?.group === 'guest-status');
      if (gs?.types) guestStatus = { value: toNum(gs.types.id), label: gs.types.name };

      const firstName = folio.first_name ?? '';
      const lastName = folio.last_name ?? '';
      const guestName = firstName !== '' || lastName !== ''
        ? `${firstName} ${lastName}`.trim()
        : guestProfile?.account ?? '';

      const company = (folio.company_name !== '' && folio.company_name !== null)
        ? folio.company_name
        : folio.company_profiles_folios_company_profile_idTocompany_profiles?.name;

      const otherGuests = folio.id
        ? await prisma.other_guests.findMany({
            where: { folio_id: Number(folio.id) },
            include: { guest_profiles: true },
          })
        : [];
      const sharer = otherGuests
        .map((v) => `${v.guest_profiles?.first_name ?? ''} ${v.guest_profiles?.last_name ?? ''}`.trim())
        .filter((s) => s !== '')
        .join(', ');

      const data = {
        folio_number: folio.folio_number,
        res_date: folio.res_date ? `${String(folio.res_date.getDate()).padStart(2, '0')}-${String(folio.res_date.getMonth() + 1).padStart(2, '0')}-${folio.res_date.getFullYear()}` : null,
        type_reservation: (folio.type_reservation ?? '').toUpperCase(),
        guest_name: guestName,
        guest_status: guestStatus,
        room: current,
        company: company ?? null,
        check_in_date: folio.check_in_date,
        check_out_date: folio.check_out_date,
        sharer,
      };

      success(res, { data }, 'Success');
    } catch (err: any) {
      console.error('getFolio error:', err);
      error(res, 'Failed to load folio', 500);
    }
  }

  // ── POST /pos/post-transactions ──
  static async postTransactions(req: Request, res: Response): Promise<void> {
    let logRow: any = null;
    try {
      const { client_uid } = req.body;
      if (!client_uid) { badRequest(res, 'The client uid field is required.'); return; }

      const uuid = randomUUID();
      logRow = await prisma.third_party_logs.create({
        data: { name: 'POS-transactions', text: JSON.stringify({ uuid, request: req.body }) },
      });

      const property = await prisma.properties.findFirst({ where: { client_uid }, orderBy: { id: 'asc' } });
      if (!property) { notFound(res, 'Client not found.'); return; }

      const logAudit = await prisma.log_audits.findFirst({
        where: { property_id: Number(property.id) },
        orderBy: { date: 'desc' },
      });
      const businessDate = logAudit ? dayAfter(logAudit.date) : new Date();

      let folio = await prisma.folios.findFirst({
        where: { property_id: property.id, is_pos_trx: true },
      });
      if (!folio) { notFound(res, 'Reservation not found.'); return; }

      let isAccount = false;
      let account: string | null = null;
      let roomID: string | null = null;
      let isRoomCharge = false;
      if (Array.isArray(req.body.payment_json)) {
        for (const pj of req.body.payment_json) {
          if (String(pj.methoddesc ?? '').toLowerCase() === 'account') { account = pj.account ?? null; isAccount = true; }
          if (String(pj.methoddesc ?? '').toLowerCase() === 'room charge') { isRoomCharge = true; roomID = pj.room ?? null; }
        }
      }

      if (isAccount && account) {
        const f = await prisma.folios.findFirst({
          where: {
            property_id: property.id,
            folio_number: String(account).toUpperCase(),
            status_reservation: STATUS_RESERVATION.check_in,
          },
        });
        if (!f) { notFound(res, 'Reservation not found.'); return; }
        folio = f;
      }

      if (isRoomCharge && roomID) {
        const rooms = await prisma.rooms.findMany({
          where: { property_id: property.id, name: roomID },
        });
        const roomIds = rooms.map((r) => r.id);
        const f = await prisma.folios.findFirst({
          where: {
            property_id: property.id,
            check_in_date: { lte: businessDate },
            check_out_date: { gte: businessDate },
            status_reservation: STATUS_RESERVATION.check_in,
            reservations: { some: { room_id: { in: roomIds } } },
          },
        });
        if (!f) { notFound(res, 'Reservation not found.'); return; }
        folio = f;
      }

      const logs: any[] = [];
      const source = (isAccount && account) || (isRoomCharge && roomID) ? 'hms' : 'pos';
      const description = `${req.body.pos_username ?? ''}-${req.body.receipt_no ?? ''}-${uuid}`;
      const createdFromDate = (raw: any): Date => {
        const d = new Date(raw ?? businessDate);
        return Number.isNaN(d.getTime()) ? businessDate : d;
      };

      await prisma.$transaction(async (tx) => {
        const morph = async (transactionId: bigint) => {
          if (folio.guest_profile_id) {
            await tx.transactions.update({ where: { id: transactionId }, data: { model_type: 'App\\Models\\GuestProfile', model_id: folio.guest_profile_id } });
          } else if (folio.company_profile_id) {
            await tx.transactions.update({ where: { id: transactionId }, data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id } });
          }
        };

        if (Array.isArray(req.body.payment_json)) {
          for (const value of req.body.payment_json) {
            const method = String(value.methoddesc ?? '').toLowerCase();
            if (method === 'account' || method === 'room charge') continue;

            let typePayment = await tx.type_payments.findFirst({
              where: { property_id: property.id, name: value.methoddesc },
              include: { code_posts: true },
            });
            if (!typePayment) {
              typePayment = await tx.type_payments.findFirst({
                where: { property_id: property.id, name: { contains: 'CASH', mode: 'insensitive' } },
                include: { code_posts: true },
              });
              if (!typePayment) { throw { code: 404, message: 'Payment Method not found.' }; }
            }

            const payAmount = Number(value.pay_amount ?? 0);
            const typeAmount = payAmount > 0 ? 'MINUS' : 'PLUS';
            let surcharge: number;
            if (typePayment.surcharge_type === 1) {
              surcharge = Number(typePayment.surcharge) < 0 ? Number(typePayment.surcharge) : Number(typePayment.surcharge) * -1;
            } else {
              surcharge = payAmount * (Number(typePayment.surcharge) / 100);
            }

            const transaction = await tx.transactions.create({
              data: {
                svr_chrg: 0,
                pb1: 0,
                tax3: 0,
                amount: payAmount > 0 ? payAmount - surcharge : (payAmount - surcharge) * -1,
                surcharge: surcharge > 0 ? surcharge : surcharge * -1,
                total: payAmount > 0 ? payAmount : payAmount * -1,
                type_amount: typeAmount,
                date: businessDate,
                created_at: createdFromDate(value.date_added),
                type: 'payment',
                source,
                is_posting: 1,
                is_endshift: 1,
                receipt: req.body.receipt_no ?? null,
                is_end_of_day: 0,
                code: typePayment.code_posts ? String(typePayment.code_posts.id) : null,
                type_payment_id: typePayment.id,
                description,
                status: STATUS_ACTIVE,
                property_id: property.id,
                folio_id: folio.id,
              },
            });
            await morph(transaction.id);
            logs.push(transaction);
          }
        }

        if (Array.isArray(req.body.sales_matrix_json)) {
          for (const value of req.body.sales_matrix_json) {
            let postMatrixSales = await tx.pos_matrix_sales.findFirst({
              where: {
                property_id: property.id,
                sales_category: value.sales_category ?? undefined,
                sales_shift: value.shift ?? undefined,
                menu_group: value.menu_group ?? undefined,
                code_post_id: { not: null },
              },
              include: { code_posts: true },
            });
            let idcodepost: bigint | null = null;
            if (postMatrixSales?.code_posts) {
              idcodepost = postMatrixSales.code_posts.id;
            } else {
              const cp = await tx.code_posts.findFirst({
                where: { property_id: property.id, name: { contains: 'DINE IN FOOD LUNCH', mode: 'insensitive' } },
              });
              if (!cp) { throw { code: 404, message: 'Post Code not found.' }; }
              idcodepost = cp.id;
            }
            const totalAmount = money(value.total_amount, 0, 'truncate');
            const serviceTotal = money(value.service_total);
            const taxTotal = money(value.tax_total);
            const baseAmount = money(totalAmount - serviceTotal - taxTotal);
            const typeAmount = totalAmount > 0 ? 'PLUS' : 'MINUS';

            const transaction = await tx.transactions.create({
              data: {
                svr_chrg: Math.abs(serviceTotal),
                pb1: Math.abs(taxTotal),
                tax3: 0,
                amount: Math.abs(baseAmount),
                surcharge: 0,
                total: Math.abs(totalAmount),
                type_amount: typeAmount,
                date: businessDate,
                created_at: createdFromDate(req.body.date_added),
                type: 'manual_posting',
                code: idcodepost ? String(idcodepost) : null,
                pos_matrix_sales_id: postMatrixSales?.id ?? null,
                receipt: req.body.receipt_no ?? null,
                source,
                is_posting: 1,
                is_endshift: 1,
                is_end_of_day: 0,
                description,
                status: STATUS_ACTIVE,
                property_id: property.id,
                folio_id: folio.id,
              },
            });
            try {
              await tx.transaction_pos_details.create({
                data: { transaction_id: transaction.id, data: JSON.stringify(value.item_json ?? []) },
              });
            } catch { /* Laravel swallows */ }
            await morph(transaction.id);
            logs.push(transaction);
          }
        }

        if (req.body.tip_amount !== undefined && Number(req.body.tip_amount) !== 0) {
          const cp = await tx.code_posts.findFirst({
            where: { property_id: property.id, name: { contains: 'rounding', mode: 'insensitive' } },
          });
          if (!cp) { throw { code: 404, message: 'Post Code not found.' }; }
          const tip = Number(req.body.tip_amount);
          const typeAmount = tip > 0 ? 'PLUS' : 'MINUS';
          const transaction = await tx.transactions.create({
            data: {
              svr_chrg: 0,
              pb1: 0,
              tax3: 0,
              amount: tip > 0 ? tip : tip * -1,
              surcharge: 0,
              total: tip > 0 ? tip : tip * -1,
              type_amount: typeAmount,
              date: businessDate,
              created_at: createdFromDate(req.body.date_added),
              type: 'manual_posting',
              code: String(cp.id),
              pos_matrix_sales_id: null,
              receipt: req.body.receipt_no ?? null,
              source,
              is_posting: 1,
              is_endshift: 1,
              remark: 'POS TIP',
              is_end_of_day: 0,
              description,
              status: STATUS_ACTIVE,
              property_id: property.id,
              folio_id: folio.id,
            },
          });
          await morph(transaction.id);
          logs.push(transaction);
        }

        if (req.body.change_total !== undefined && Number(req.body.change_total) !== 0) {
          let typePayment = await tx.type_payments.findFirst({
            where: { property_id: property.id, name: { contains: 'cash fb', mode: 'insensitive' } },
            include: { code_posts: true },
          });
          if (!typePayment) {
            typePayment = await tx.type_payments.findFirst({
              where: { property_id: property.id, name: { contains: 'CASH', mode: 'insensitive' } },
              include: { code_posts: true },
            });
            if (!typePayment) { throw { code: 404, message: 'Payment Method not found.' }; }
          }
          const changeTotal = Number(req.body.change_total);
          const typeAmount = changeTotal > 0 ? 'MINUS' : 'PLUS';
          let surcharge: number;
          if (typePayment.surcharge_type === 1) {
            surcharge = Number(typePayment.surcharge) < 0 ? Number(typePayment.surcharge) : Number(typePayment.surcharge) * -1;
          } else {
            surcharge = changeTotal * (Number(typePayment.surcharge) / 100);
          }
          const transaction = await tx.transactions.create({
            data: {
              svr_chrg: 0,
              pb1: 0,
              tax3: 0,
              amount: changeTotal > 0 ? changeTotal - surcharge : (changeTotal - surcharge) * -1,
              surcharge: surcharge > 0 ? surcharge : surcharge * -1,
              total: changeTotal > 0 ? changeTotal : changeTotal * -1,
              type_amount: typeAmount,
              date: businessDate,
              created_at: createdFromDate(req.body.date_added),
              type: 'payment',
              source,
              is_posting: 1,
              is_endshift: 1,
              receipt: req.body.receipt_no ?? null,
              is_end_of_day: 0,
              code: typePayment.code_posts ? String(typePayment.code_posts.id) : null,
              type_payment_id: typePayment.id,
              description,
              status: STATUS_ACTIVE,
              property_id: property.id,
              folio_id: folio.id,
            },
          });
          await morph(transaction.id);
          logs.push(transaction);
        }
      });

      success(res, { logs: toNum(logs) }, 'Success');
    } catch (err: any) {
      if (err?.code === 404) {
        notFound(res, err.message);
        return;
      }
      try {
        if (logRow?.id) {
          await prisma.third_party_logs.update({
            where: { id: logRow.id },
            data: { text: JSON.stringify({ error: err?.message ?? 'Failed', file: err?.stack ?? '', line: '' }) },
          });
        }
      } catch { /* ignore */ }
      console.error('postTransactions error:', err);
      error(res, 'Failed', 500);
    }
  }
}
