// Verification only. Inserts a second pending folio so the notification poller has
// something genuinely new to discover mid-session, and prints the ids to remove.
const { execFileSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");

const PSQL = "C:\\laragon\\bin\\postgresql\\postgresql\\bin\\psql.exe";
const run = (sql) =>
	execFileSync(PSQL, ["-h", "localhost", "-U", "postgres", "-d", "hms_anyaman", "-t", "-A", "-c", sql], {
		encoding: "utf8",
	}).trim();

const stamp = Date.now();
const uuid = crypto.randomUUID();
const folio = `F999V${String(stamp).slice(-9)}`;

const sql = `
INSERT INTO folios (
  folio_number, booking_no, booking_engine_uuid, email, property_id,
  check_in_date, check_out_date, status_reservation, total_amount, created_at, updated_at
) VALUES (
  '${folio}', 'OL${folio.slice(1)}', '${uuid}', 'uzumakirianto@gmail.com', 999,
  '2026-11-01', '2026-11-03', 3, 1200000, now(), now()
)
RETURNING id;`;

const id = run(sql);
console.log(JSON.stringify({ id: Number(id), folio, uuid }));
fs.writeFileSync("inserted-folio.json", JSON.stringify({ id: Number(id), folio, uuid }));
