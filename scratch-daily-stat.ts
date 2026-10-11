import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pid = 1001n; // Anyaman
  const bdate = '2023-12-01';

  const sql = `
WITH params AS (
    SELECT $1::bigint AS pid, $2::date AS bdate
),
rooms_stat AS (
    SELECT 
        (SELECT COUNT(*) FROM rooms WHERE property_id = p.pid AND deleted_at IS NULL AND is_physical = true) AS total_rooms,
        (SELECT COUNT(*) FROM rooms WHERE property_id = p.pid AND deleted_at IS NULL AND status IN ('occupied', 'due_out')) AS occupied_rooms,
        (SELECT COUNT(*) FROM rooms WHERE property_id = p.pid AND deleted_at IS NULL AND status = 'vacant') AS vacant_rooms,
        (SELECT COUNT(*) FROM rooms WHERE property_id = p.pid AND deleted_at IS NULL AND room_status = 6) AS blocked_rooms,
        (SELECT COUNT(*) FROM room_allotment WHERE deleted_at IS NULL) AS allocations_remaining
    FROM params p
),
rsv_stat AS (
    SELECT
        (SELECT COUNT(*) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.check_in_date) = p.bdate AND DATE(r.check_out_date) = p.bdate AND r.deleted_at IS NULL) AS day_use_rooms,
        (SELECT COUNT(*) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.check_in_date) = p.bdate AND r.deleted_at IS NULL) AS room_sold,
        (SELECT COUNT(*) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND f.status_reservation = 1 AND r.deleted_at IS NULL) AS room_booked,
        (SELECT COALESCE(SUM(r.adult), 0) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.date) = p.bdate AND r.deleted_at IS NULL) AS adults,
        (SELECT COALESCE(SUM(r.child), 0) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.date) = p.bdate AND r.deleted_at IS NULL) AS children,
        (SELECT COALESCE(SUM(r.amount), 0) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.date) = p.bdate AND r.deleted_at IS NULL) AS room_revenue,
        (SELECT COUNT(*) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.check_in_date) = p.bdate AND r.deleted_at IS NULL) AS arrivals,
        (SELECT COUNT(*) FROM reservations r JOIN folios f ON r.folio_id = f.id WHERE f.property_id = p.pid AND DATE(r.check_out_date) = p.bdate AND r.deleted_at IS NULL) AS departures
    FROM params p
),
folio_stat AS (
    SELECT
        (SELECT COUNT(*) FROM folios WHERE property_id = p.pid AND status_reservation = 1) AS reservations_processed,
        (SELECT COUNT(*) FROM folios WHERE property_id = p.pid AND DATE(check_in_date) = p.bdate AND status_reservation = 1) AS reservations_arrivals,
        (SELECT COUNT(*) FROM folios WHERE property_id = p.pid AND DATE(check_in_date) = p.bdate AND status_reservation = 4) AS cancellations,
        (SELECT COUNT(*) FROM folios WHERE property_id = p.pid AND status_reservation = 5) AS no_shows,
        (SELECT COUNT(*) FROM folios WHERE property_id = p.pid AND status_reservation = 2) AS in_house_folios
    FROM params p
)
SELECT * FROM rooms_stat, rsv_stat, folio_stat;
  `;

  try {
      const result = await prisma.$queryRawUnsafe(sql, pid, bdate);
      console.log(result);
  } catch (e) {
      console.error(e);
  } finally {
      await prisma.$disconnect();
  }
}

main();
