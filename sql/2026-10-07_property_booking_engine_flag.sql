-- 2026-10-07_property_booking_engine_flag.sql
--
-- Adds `properties.is_booking_engine`: whether a property is published to the guest
-- portal (booking engine).
--
-- Before this the only gate was `properties.status`, which is HMS-wide. So Bali Bagus
-- Lovina is `status = 0` and correctly hidden, but every other property was published
-- whether or not its content was ready: 8 hotels showed up in `/loyalty`, and the HMS
-- dashboard offered the Booking Engine launcher to a front-desk user regardless of
-- whether that hotel could actually take an online booking. This flag is the per-property
-- answer and is what `/middleware/loyalty/properties` and the dashboard launcher read.
--
-- Idempotent, no data movement. Existing rows are seeded to match what is actually live
-- today — the five properties the booking engine already resolves by `client_uid`
-- (999 KURETAKESO, 1002 HOTEL OLIVE, 1003 Ow! Hotel) plus 1000 Anyaman, 1004 Shangri-La
-- and 1005 asialink, which have real room types, facilities and slugs. 1001 Bali Bagus
-- Lovina stays 0 (it is `status = 0` anyway) and 1006 Rama Beach stays 0: its slug is
-- `somnum-chalets`, it was never published, and turning it on by default would put a
-- property nobody has looked at in front of guests.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS is_booking_engine smallint NOT NULL DEFAULT 0;

UPDATE properties SET is_booking_engine = 1 WHERE id IN (999, 1000, 1002, 1003, 1004, 1005);

-- Prisma reads the schema from `properties`, so the generated client needs the column.
-- Verified after `npx prisma generate`:
--   properties.findMany({ select: { is_booking_engine: true } })  -> typechecks