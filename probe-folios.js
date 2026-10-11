// Verification only. Inspects the folios table for a template row to clone when
// simulating "a stay just appeared that needs pre-registration".
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

(async () => {
	const cols = await prisma.$queryRawUnsafe(`
		SELECT column_name, is_nullable, column_default
		FROM information_schema.columns
		WHERE table_name = 'folios'
		ORDER BY ordinal_position
	`);
	console.log(
		"folios columns:",
		cols.map((c) => c.column_name).join(", "),
	);
	console.log("required (no default, not null):");
	console.log(
		cols
			.filter((c) => c.is_nullable === "NO" && c.column_default === null)
			.map((c) => "  " + c.column_name)
			.join("\n"),
	);

	const rows = await prisma.$queryRawUnsafe(`
		SELECT id, folio_number, booking_no, booking_engine_uuid, email,
		       property_id, guest_profile_id, check_in_date, check_out_date,
		       status_reservation, total_amount, pre_registration_token,
		       pre_registration_completed_at
		FROM folios
		WHERE booking_engine_uuid IS NOT NULL
		ORDER BY id DESC
		LIMIT 4
	`);
	console.log("recent booking-engine folios:", JSON.stringify(rows, null, 1));

	await prisma.$disconnect();
})().catch((e) => {
	console.error("ERR", e.message);
	process.exit(1);
});
