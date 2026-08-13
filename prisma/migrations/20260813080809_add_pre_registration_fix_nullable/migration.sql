-- AlterTable
ALTER TABLE "cities" ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "folios" ADD COLUMN     "pre_registration_completed_at" TIMESTAMP(3),
ADD COLUMN     "pre_registration_expires_at" TIMESTAMP(3),
ADD COLUMN     "pre_registration_token" TEXT;

-- AlterTable
ALTER TABLE "rooms" ALTER COLUMN "cleaning_time" SET DEFAULT '1970-01-01 00:00:00';

-- CreateIndex
CREATE INDEX "folios_pre_registration_token_idx" ON "folios"("pre_registration_token");

-- CreateIndex
CREATE INDEX "folios_folio_number_pre_registration_completed_at_idx" ON "folios"("folio_number", "pre_registration_completed_at");
