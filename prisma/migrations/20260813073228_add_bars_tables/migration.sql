-- AlterTable
ALTER TABLE "cities" ALTER COLUMN "created_at" SET DEFAULT '2013-12-31 23:31:01';

-- AlterTable
ALTER TABLE "rooms" ALTER COLUMN "cleaning_time" SET DEFAULT '1970-01-01 00:00:00';

-- CreateTable
CREATE TABLE "bars" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "code_post_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bar_inclusives" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "bar_id" BIGINT NOT NULL,
    "description" TEXT,
    "frequency" TEXT,
    "cost" TEXT,
    "cost_on" TEXT,
    "updated_at" TIMESTAMP(3),
    "updated_by" BIGINT,

    CONSTRAINT "bar_inclusives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bar_rates" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "bar_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3),
    "updated_by" BIGINT,

    CONSTRAINT "bar_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bars_property_id_idx" ON "bars"("property_id");

-- CreateIndex
CREATE INDEX "bars_code_post_id_idx" ON "bars"("code_post_id");

-- CreateIndex
CREATE INDEX "bar_inclusives_property_id_idx" ON "bar_inclusives"("property_id");

-- CreateIndex
CREATE INDEX "bar_inclusives_bar_id_idx" ON "bar_inclusives"("bar_id");

-- CreateIndex
CREATE INDEX "bar_rates_property_id_idx" ON "bar_rates"("property_id");

-- CreateIndex
CREATE INDEX "bar_rates_bar_id_idx" ON "bar_rates"("bar_id");

-- CreateIndex
CREATE INDEX "bar_rates_room_type_id_idx" ON "bar_rates"("room_type_id");

-- AddForeignKey
ALTER TABLE "guest_profile_preferences" ADD CONSTRAINT "guest_profile_preferences_id_guest_profile_fkey" FOREIGN KEY ("id_guest_profile") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bars" ADD CONSTRAINT "bars_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bars" ADD CONSTRAINT "bars_code_post_id_fkey" FOREIGN KEY ("code_post_id") REFERENCES "code_posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bar_inclusives" ADD CONSTRAINT "bar_inclusives_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bar_inclusives" ADD CONSTRAINT "bar_inclusives_bar_id_fkey" FOREIGN KEY ("bar_id") REFERENCES "bars"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bar_rates" ADD CONSTRAINT "bar_rates_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bar_rates" ADD CONSTRAINT "bar_rates_bar_id_fkey" FOREIGN KEY ("bar_id") REFERENCES "bars"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bar_rates" ADD CONSTRAINT "bar_rates_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
