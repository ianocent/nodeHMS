-- AlterTable
ALTER TABLE "cities" ALTER COLUMN "updated_at" DROP NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rooms" ALTER COLUMN "cleaning_time" SET DEFAULT '1970-01-01 00:00:00';
