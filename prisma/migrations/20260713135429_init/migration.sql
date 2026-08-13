-- CreateEnum
CREATE TYPE "housekeeping_setups_used_by" AS ENUM ('hk', 'hkspv', 'both');

-- CreateEnum
CREATE TYPE "tasks_status" AS ENUM ('Open', 'In Progress', 'Closed', 'Cancelled');

-- CreateEnum
CREATE TYPE "tasks_priority" AS ENUM ('Low', 'Medium', 'High', 'Urgent');

-- CreateEnum
CREATE TYPE "event_events_status" AS ENUM ('Tentative', 'Canceled', 'To Be Announced', 'Definitely', 'Fix');

-- CreateTable
CREATE TABLE "accountings" (
    "id" BIGSERIAL NOT NULL,
    "type_accounting" TEXT,
    "outstanding" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "number_note" TEXT,
    "type" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "doc_date" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "type_payment_id" BIGINT,
    "transaction_id" BIGINT,
    "code_item_id" BIGINT,
    "company_profile_id" BIGINT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(65,30),
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "pb1" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "svr_chrg" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "surcharge" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "tax3" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "closing" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "overwrite_reason" TEXT,
    "time" TIMESTAMP(3),
    "bill_to" TEXT,
    "model_type" TEXT,
    "model_id" BIGINT,
    "void_code" TEXT,
    "reference" TEXT,
    "source" TEXT,
    "pos" TEXT,
    "receipt" TEXT,
    "card_name" TEXT,
    "last_digit_card" INTEGER,
    "remark" TEXT,
    "voucher" TEXT,
    "booking" TEXT,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT,
    "is_posting" INTEGER NOT NULL DEFAULT 0,
    "is_endshift" INTEGER NOT NULL DEFAULT 0,
    "is_void" INTEGER NOT NULL DEFAULT 0,
    "is_transfer" INTEGER NOT NULL DEFAULT 0,
    "is_consolidate" INTEGER NOT NULL DEFAULT 0,
    "is_split" INTEGER NOT NULL DEFAULT 0,
    "is_has_inclusive" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "status_accounting" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "accountings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_accountings" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "unique" TEXT,
    "property_id" BIGINT NOT NULL,
    "accounting_id" BIGINT NOT NULL,
    "allocated" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "allocation_accountings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allotments" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "release_allotment" INTEGER NOT NULL DEFAULT 0,
    "model_type" TEXT,
    "model_id" BIGINT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "allotments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_transfers" (
    "id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "folio_id" INTEGER NOT NULL,
    "target_folio_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baggages" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "tag_no" TEXT,
    "remark" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "file" TEXT,
    "phone_number" TEXT,
    "file_path" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "baggages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_report" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "batch_list" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "batch_name" TEXT,

    CONSTRAINT "batch_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_tos" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "billing_code" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "billing_tos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancelation_rule_dates" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "uuid" TEXT NOT NULL,
    "cancelation_rule_id" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "cancelation_rule_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancelation_rules" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "uuid" TEXT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type_date" TEXT NOT NULL,
    "type_refund" TEXT,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "value_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "cancelation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_parks" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "room" INTEGER,
    "remark" TEXT,
    "car_park_lot" TEXT,
    "vehicle_no" TEXT,
    "folio" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "car_parks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_manager_interfaces" (
    "id" BIGSERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "hotel_type" TEXT NOT NULL,
    "hotel_name" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "language_code" TEXT NOT NULL DEFAULT 'en',
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "hotel_info" TEXT,
    "hotel_description" TEXT,
    "last_sync" TIMESTAMP(3),
    "data" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "channel_manager_interfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_manager_rate_plans" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "data" TEXT,
    "rate_id" BIGINT NOT NULL,
    "channel_manager_interface_id" BIGINT NOT NULL,
    "meal_plan_id" INTEGER NOT NULL,
    "last_sync" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "channel_manager_rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_manager_room_types" (
    "id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "channel_manager_interface_id" BIGINT NOT NULL,
    "data" TEXT,
    "last_sync" TIMESTAMP(3),
    "room_type_id" BIGINT NOT NULL,
    "max_occupancy" INTEGER NOT NULL,
    "max_child_occupancy" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "room_type" BIGINT NOT NULL,
    "size_measurement" DOUBLE PRECISION NOT NULL,
    "size_measurement_unit" TEXT NOT NULL,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "address_line" TEXT,
    "city_name" TEXT,
    "country_name" TEXT,
    "postal_code" TEXT,
    "description" TEXT,
    "room_description" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "channel_manager_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "state_id" BIGINT,
    "state_code" TEXT,
    "country_id" BIGINT NOT NULL,
    "country_code" TEXT,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT '2013-12-31 23:31:01',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flag" BOOLEAN NOT NULL DEFAULT true,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "wikiDataId" TEXT,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_billings" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPOS" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "code_billings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_gls" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "description" TEXT,
    "account_uid" TEXT,
    "groupcode" TEXT,
    "mastercode" TEXT,
    "controlname" TEXT,
    "leveltype" TEXT,
    "balancetype" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "code_gls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_items" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "code_post_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "is_event" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "sales" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "process_on" TEXT,
    "calculator" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "code_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_posts" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEFAULT',
    "code_billing_id" BIGINT,
    "code_gl_id" BIGINT,
    "name" TEXT NOT NULL,
    "uuid" TEXT,
    "pay_commission" INTEGER NOT NULL DEFAULT 0,
    "is_pos" INTEGER NOT NULL DEFAULT 0,
    "local_tax" INTEGER NOT NULL DEFAULT 0,
    "local_tax_percentage" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "service_charge" INTEGER NOT NULL DEFAULT 0,
    "service_charge_percentage" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "service_charge_include_local_tax" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "tax_percentage" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "tax_include_local_tax" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "code_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "ip" TEXT,
    "contract_expired" TIMESTAMP(3),
    "join_date" TIMESTAMP(3),
    "npwp" TEXT,
    "lat" TEXT,
    "long" TEXT,
    "no_tlp" TEXT,
    "image" TEXT,
    "pic_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_contract_rate" (
    "id" BIGSERIAL NOT NULL,
    "rate_code" INTEGER,
    "description" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER,
    "company_profile_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,

    CONSTRAINT "company_contract_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_guests" (
    "id" BIGSERIAL NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "mobile_phone" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER,
    "company_profile_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,

    CONSTRAINT "company_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_activities" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "subject" TEXT,
    "objective" TEXT,
    "notes" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "company_profile_id" BIGINT NOT NULL,

    CONSTRAINT "company_profile_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_ar_transactions" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "transaction_code" TEXT,
    "document" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "company_profile_ar_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_billing_logs" (
    "id" BIGSERIAL NOT NULL,
    "amount" DECIMAL(65,30),
    "company_profile_id" BIGINT,
    "transaction_id" BIGINT,
    "date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "created_by" BIGINT,

    CONSTRAINT "company_profile_billing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_billing_setups" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "code_billing_id" BIGINT NOT NULL,
    "billing" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "company_profile_billing_setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_contact_persons" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "position" TEXT,
    "department" BIGINT,
    "tel" TEXT,
    "mobile_phone" TEXT,
    "fax" TEXT,
    "dob" TIMESTAMP(3),
    "notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "company_profile_contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_customed_onlines" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "based_online_code" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "customed_online_comm" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "company_profile_customed_onlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_departments" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "department" TEXT,
    "country_id" BIGINT,
    "city_id" BIGINT,
    "postal_code" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT,

    CONSTRAINT "company_profile_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_documents" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "file" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "file_path" TEXT,

    CONSTRAINT "company_profile_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_statistics" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "room_night" INTEGER NOT NULL,
    "room_revenue" DECIMAL(65,30) NOT NULL,
    "other_revenue" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "arr" TEXT,
    "month" TIMESTAMP(3),

    CONSTRAINT "company_profile_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "uuid" TEXT,
    "code_billing_id" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "type_company" TEXT,
    "account" TEXT,
    "short_code" TEXT,
    "status_company" TEXT,
    "telp" TEXT,
    "mobile_phone" TEXT,
    "business_regional" TEXT,
    "IATA" TEXT,
    "email" TEXT,
    "billing_address" TEXT,
    "billing_region" TEXT,
    "billing_country" TEXT,
    "billing_city" TEXT,
    "billing_postal_code" TEXT,
    "mailing_address" TEXT,
    "mailing_region" TEXT,
    "mailing_country" TEXT,
    "mailing_city" TEXT,
    "mailing_postal_code" TEXT,
    "term" TEXT,
    "credit_limit" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "remaining" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "is_stop_credit" BOOLEAN NOT NULL DEFAULT false,
    "gst" BOOLEAN NOT NULL DEFAULT false,
    "commission_rate" DOUBLE PRECISION,
    "is_pay_commission" BOOLEAN DEFAULT false,
    "is_company_booking_engine" BOOLEAN NOT NULL DEFAULT false,
    "is_charge_back" BOOLEAN DEFAULT false,
    "is_surcharge_opt_out" BOOLEAN DEFAULT false,
    "based_online_commission" DOUBLE PRECISION,
    "remarks" TEXT,
    "sync_commission_type" TEXT,
    "sync_mkt_segment_1" TEXT,
    "sync_mkt_segment_2" TEXT,
    "sync_mkt_segment_3" TEXT,
    "sync_mkt_segment_4" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "blacklist" INTEGER NOT NULL DEFAULT 0,
    "website" TEXT,
    "fax" TEXT,
    "staff_in_charge" TEXT,
    "source" TEXT,
    "billing" TEXT,
    "default_event_type" TEXT,
    "comm_payable" BIGINT,
    "comm_code" TEXT,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_banners" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "image" TEXT,
    "description" TEXT,
    "uuid" TEXT,
    "url" TEXT,
    "sync" TEXT,

    CONSTRAINT "content_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_breakdowns" (
    "id" SERIAL NOT NULL,
    "content_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "adult" INTEGER DEFAULT 0,
    "child" INTEGER DEFAULT 0,
    "descriptions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "content_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_optional_items" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "uuid" TEXT,
    "content_room_id" BIGINT NOT NULL,
    "item_code_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "sort" INTEGER,

    CONSTRAINT "content_optional_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_room_breakdowns" (
    "id" SERIAL NOT NULL,
    "content_room_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "adult" INTEGER DEFAULT 0,
    "child" INTEGER DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "content_room_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_room_facilities" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT,
    "content_room_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "content_room_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_room_images" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT,
    "content_room_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "content_room_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_rooms" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "max_pax" INTEGER NOT NULL DEFAULT 1,
    "type_discount" TEXT NOT NULL,
    "value_discount" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "room_type_id" BIGINT,
    "data" TEXT,

    CONSTRAINT "content_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT,
    "keyword" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "image" TEXT,
    "description" TEXT,
    "url" TEXT,
    "group" TEXT,
    "room_type_id" BIGINT,
    "language" TEXT,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "iso3" TEXT,
    "numeric_code" TEXT,
    "iso2" TEXT,
    "phonecode" TEXT,
    "capital" TEXT,
    "currency" TEXT,
    "currency_name" TEXT,
    "currency_symbol" TEXT,
    "tld" TEXT,
    "native" TEXT,
    "region" TEXT,
    "region_id" BIGINT,
    "subregion" TEXT,
    "subregion_id" BIGINT,
    "nationality" TEXT,
    "timezones" TEXT,
    "translations" TEXT,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "emoji" TEXT,
    "emojiU" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flag" BOOLEAN DEFAULT true,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "wikiDataId" TEXT,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_limit_histories" (
    "id" BIGSERIAL NOT NULL,
    "remaining" DECIMAL(65,30) NOT NULL,
    "type" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_profile_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "transaction_id" BIGINT NOT NULL,

    CONSTRAINT "credit_limit_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debugs" (
    "id" SERIAL NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "debugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_events" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3),
    "type_payment_id" BIGINT NOT NULL,
    "amount" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "deposit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_payments" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3),
    "payment_type" BIGINT NOT NULL,
    "amount" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "deposit_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doorlock_configs" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "assign_at" TIMESTAMP(3),
    "checkin" TIMESTAMP(3),
    "checkout" TIMESTAMP(3),
    "roomcode" TEXT,
    "roomtypecode" TEXT,
    "floorcode" TEXT,
    "buildingcode" TEXT,
    "holder" TEXT,
    "idno" TEXT,
    "port" TEXT,
    "breakfast" BOOLEAN DEFAULT false,
    "overite" BOOLEAN DEFAULT false,
    "is_assign" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "doorlock_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doorlock_duplicate_counters" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "doorlock_duplicate_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dynamic_rate_configs" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "forecast_method" TEXT DEFAULT 'moving_average',
    "gdp_growth_rate" DECIMAL(65,30) DEFAULT 0.0000,
    "inflation_rate" DECIMAL(65,30) DEFAULT 0.0000,
    "adjustment_sensitivity" DECIMAL(65,30) DEFAULT 1.0000,
    "min_adjustment_percent" DECIMAL(65,30) DEFAULT -100.0000,
    "max_adjustment_percent" DECIMAL(65,30) DEFAULT 100.0000,
    "lookback_days" INTEGER DEFAULT 90,
    "forecast_days" INTEGER DEFAULT 30,
    "target_occupancy" DECIMAL(65,30) DEFAULT 70.0000,
    "seasonality_factors" JSONB,
    "is_active" INTEGER DEFAULT 1,
    "auto_apply" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "dynamic_rate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dynamic_rate_results" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "dynamic_rate_config_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "historical_adr" DECIMAL(65,30) DEFAULT 0.00,
    "forecasted_occupancy" DECIMAL(65,30) DEFAULT 0.0000,
    "base_rate" DECIMAL(65,30) DEFAULT 0.00,
    "suggested_rate_one_adult" DECIMAL(65,30) DEFAULT 0.00,
    "suggested_rate_two_adult" DECIMAL(65,30) DEFAULT 0.00,
    "adjustment_percent" DECIMAL(65,30) DEFAULT 0.0000,
    "gdp_impact" DECIMAL(65,30) DEFAULT 0.0000,
    "inflation_impact" DECIMAL(65,30) DEFAULT 0.0000,
    "seasonality_factor" DECIMAL(65,30) DEFAULT 1.0000,
    "occupancy_factor" DECIMAL(65,30) DEFAULT 1.0000,
    "confidence_score" DECIMAL(65,30) DEFAULT 0.0000,
    "forecast_method_used" TEXT,
    "is_applied" INTEGER DEFAULT 0,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "dynamic_rate_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_builders" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "template_name" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "email_builders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_groups" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "group_name" TEXT,
    "group_list" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "email_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_capacities" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "pax" INTEGER NOT NULL,
    "venue_id" INTEGER NOT NULL,
    "layout_id" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deposit_actuals" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "event_id" INTEGER NOT NULL,
    "portion" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deposit_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deposit_plans" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "event_id" INTEGER NOT NULL,
    "portion" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deposit_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_event_items" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "code_item_id" INTEGER NOT NULL,
    "quantity" INTEGER,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_event_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_events" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "event_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_start_time" TIMESTAMP(3) NOT NULL,
    "event_end_time" TIMESTAMP(3) NOT NULL,
    "guest_name" TEXT,
    "guest_phone" TEXT,
    "guest_email" TEXT,
    "company_profile_id" BIGINT,
    "sales_in_charge" BIGINT,
    "package_id" INTEGER,
    "venue_id" INTEGER,
    "layout_id" INTEGER,
    "pax" INTEGER,
    "folio_id" BIGINT,
    "status" "event_events_status" NOT NULL DEFAULT 'Tentative',
    "description" TEXT,
    "total_amount" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "event_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_instructions" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "banquet" TEXT,
    "fo" TEXT,
    "kitchen" TEXT,
    "housekeeping" TEXT,
    "steward" TEXT,
    "engineering" TEXT,
    "restaurant" TEXT,
    "security" TEXT,
    "bar" TEXT,
    "mcm" TEXT,
    "sales_marketing" TEXT,
    "order_taken_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_inventories" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "code_post_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "sales" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_layouts" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_management_items" (
    "id" BIGSERIAL NOT NULL,
    "code_item_id" BIGINT NOT NULL,
    "event_management_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL,
    "description" TEXT,
    "cost_on" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,

    CONSTRAINT "event_management_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_managements" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "number_guest" INTEGER NOT NULL,
    "description" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_managements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_package_items" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "package_id" INTEGER NOT NULL,
    "code_item_id" INTEGER NOT NULL,
    "quantity" INTEGER,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_packages" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "name" TEXT NOT NULL,
    "capacity_id" INTEGER,
    "max_capacity" INTEGER,
    "venue_id" INTEGER,
    "layout_id" INTEGER,
    "description" TEXT,
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "event_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_venues" (
    "property_id" INTEGER NOT NULL,
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_venues_layouts" (
    "venue_id" INTEGER NOT NULL,
    "layout_id" INTEGER NOT NULL,

    CONSTRAINT "event_venues_layouts_pkey" PRIMARY KEY ("venue_id","layout_id")
);

-- CreateTable
CREATE TABLE "failed_jobs" (
    "id" BIGSERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "connection" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "exception" TEXT NOT NULL,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folios" (
    "id" BIGSERIAL NOT NULL,
    "folio_number" TEXT,
    "parent" BIGINT NOT NULL DEFAULT 0,
    "property_id" BIGINT NOT NULL,
    "type_reservation" TEXT NOT NULL,
    "guest_profile_id" BIGINT,
    "company_profile_id" BIGINT NOT NULL,
    "first_name" TEXT,
    "company_name" TEXT,
    "last_name" TEXT,
    "title" TEXT,
    "telp" TEXT,
    "email" TEXT,
    "remark" TEXT,
    "remark_ins" TEXT,
    "is_gh" INTEGER NOT NULL DEFAULT 0,
    "check_in_instruction" TEXT,
    "check_out_instruction" TEXT,
    "posting_instruction" TEXT,
    "image" TEXT,
    "booking_agent_id" BIGINT,
    "dept_branch" TEXT,
    "contact_person_id" BIGINT,
    "is_pending" BOOLEAN NOT NULL DEFAULT false,
    "cash_on_arrival" BOOLEAN NOT NULL DEFAULT false,
    "guaranted" BOOLEAN NOT NULL DEFAULT false,
    "print_status" BOOLEAN NOT NULL DEFAULT false,
    "use_allotment" BOOLEAN NOT NULL DEFAULT false,
    "is_walk_in" BOOLEAN NOT NULL DEFAULT false,
    "is_house_use" BOOLEAN NOT NULL DEFAULT false,
    "is_booking_engine" BOOLEAN NOT NULL DEFAULT false,
    "complimentary" BOOLEAN NOT NULL DEFAULT false,
    "is_compliment_tour_leader" BOOLEAN NOT NULL,
    "check_in_date" TIMESTAMP(3),
    "check_out_date" TIMESTAMP(3),
    "data" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "card_type" TEXT,
    "card_number" TEXT,
    "card_expiry" TEXT,
    "status_profile" TEXT,
    "status_reservation" INTEGER,
    "gender" TEXT,
    "birth_of_date" TIMESTAMP(3),
    "mobile_phone" TEXT,
    "nationality_id" INTEGER,
    "is_subscribe" BOOLEAN,
    "is_do_not_contact" BOOLEAN,
    "is_day_use" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "city_id" INTEGER,
    "country_id" INTEGER,
    "postal_code" TEXT,
    "is_do_not_disturb" BOOLEAN DEFAULT false,
    "is_incognito" BOOLEAN DEFAULT false,
    "is_long_stay" BOOLEAN DEFAULT false,
    "is_posting" BOOLEAN DEFAULT false,
    "is_dnd" BOOLEAN DEFAULT false,
    "is_virtual" BOOLEAN NOT NULL DEFAULT false,
    "is_pos_trx" BOOLEAN NOT NULL DEFAULT false,
    "res_date" TIMESTAMP(3),
    "res_time" TIMESTAMP(3),
    "cut_off_date" TIMESTAMP(3),
    "limit_1" TEXT,
    "limit_2" TEXT,
    "flight_or_car" TEXT,
    "loyalty_card" TEXT,
    "loyalty_card_number" TEXT,
    "booking_no" TEXT,
    "promo_code" TEXT,
    "is_payment_booking_engine" BOOLEAN NOT NULL DEFAULT false,
    "is_request_cancel" BOOLEAN NOT NULL DEFAULT false,
    "is_notification" BOOLEAN NOT NULL DEFAULT false,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "booking_engine_uuid" TEXT,
    "date_arrival" TIMESTAMP(3),

    CONSTRAINT "folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profile_documents" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "guest_profile_id" BIGINT NOT NULL,
    "file" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "file_path" TEXT,

    CONSTRAINT "guest_profile_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profile_family_members" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "guest_profile_id" BIGINT NOT NULL,
    "has_guest_profile_id" BIGINT NOT NULL,
    "relationship" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_profile_family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profile_histories" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "id_guest_profile" BIGINT NOT NULL,
    "is_arrival" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_profile_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profile_loyalty_cards" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "guest_profile_id" BIGINT NOT NULL,
    "card_type" TEXT,
    "card_number" TEXT,
    "join_date" TEXT,
    "card_expiry" TIMESTAMP(3),
    "is_default" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_profile_loyalty_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profile_preferences" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "preference" TEXT,
    "remark" TEXT,
    "request_status" TEXT NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "id_guest_profile" BIGINT NOT NULL,

    CONSTRAINT "guest_profile_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profile_request_notes" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "id_guest_profile" BIGINT NOT NULL,
    "date" TIMESTAMP(3),
    "note" TEXT,
    "username" TEXT,
    "frequency" TEXT,
    "time" TEXT,
    "arrival" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_profile_request_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_profiles" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "account" TEXT NOT NULL,
    "uuid" TEXT,
    "short_code" TEXT,
    "status_profile" INTEGER DEFAULT 0,
    "first_name" TEXT,
    "last_name" TEXT,
    "region" TEXT,
    "nationality_id" INTEGER,
    "city_id" INTEGER,
    "telp" TEXT,
    "image" TEXT,
    "mobile_phone" TEXT,
    "card_type" TEXT,
    "card_number" TEXT,
    "card_expiry" TEXT,
    "email" TEXT,
    "gender" TEXT,
    "birth_of_date" TIMESTAMP(3),
    "is_subscribe" BOOLEAN NOT NULL DEFAULT false,
    "blacklist" INTEGER,
    "fax" TEXT,
    "address" TEXT,
    "postal_code" TEXT,
    "car_reg_number" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "country_id" INTEGER,

    CONSTRAINT "guest_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
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

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_competitors" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "master_hotel_competitor_id" BIGINT NOT NULL,
    "room_available" INTEGER NOT NULL,
    "room_sold" INTEGER NOT NULL,
    "arr" DECIMAL(65,30) NOT NULL,
    "total_revenue" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,

    CONSTRAINT "hotel_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeper_history" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "room_id" BIGINT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "user_id" BIGINT,
    "date" TIMESTAMP(3),
    "start_clean_time" TIMESTAMP(3),
    "end_clean_time" TIMESTAMP(3),
    "hk_checklist" TEXT,
    "hkspv_checklist" TEXT,
    "need_rec_cleaning" BOOLEAN DEFAULT false,
    "reclean_notes" TEXT,
    "done_inspection" TIMESTAMP(3),
    "inspected_by" BIGINT,
    "inspected_time" TIMESTAMP(3),
    "inspection_time" TIMESTAMP(3),

    CONSTRAINT "housekeeper_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeper_history_user" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "user_id" BIGINT,
    "housekeeper_history_id" BIGINT,

    CONSTRAINT "housekeeper_history_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_history_checklists" (
    "id" BIGSERIAL NOT NULL,
    "housekeeper_history_id" BIGINT NOT NULL,
    "housekeeping_setup_id" BIGINT NOT NULL,
    "qty_required" INTEGER NOT NULL DEFAULT 1,
    "qty_checked" INTEGER NOT NULL DEFAULT 0,
    "is_checked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "housekeeping_history_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_setup_room_types" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "housekeeping_setup_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "housekeeping_setup_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_setup_rooms" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "housekeeping_setup_id" BIGINT NOT NULL,
    "room_id" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "housekeeping_setup_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_setups" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "category" TEXT,
    "used_by" "housekeeping_setups_used_by" DEFAULT 'both',
    "mandatory_inspection" BOOLEAN DEFAULT true,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "used_by_hk" BOOLEAN DEFAULT true,
    "used_by_hkspv" BOOLEAN DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "housekeeping_setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" BIGSERIAL NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "reserved_at" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "last_user_folios" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "last_user_folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledgers" (
    "id" BIGSERIAL NOT NULL,
    "folio_id" INTEGER,
    "property_id" INTEGER,
    "code_billing_id" BIGINT,
    "profileable_id" INTEGER,
    "profileable_type" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_audits" (
    "id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" BIGINT DEFAULT 0,

    CONSTRAINT "log_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" BIGSERIAL NOT NULL,
    "batch_uuid" TEXT,
    "subject_type" TEXT,
    "subject_id" BIGINT,
    "causer_type" TEXT,
    "causer_id" BIGINT,
    "name" TEXT NOT NULL,
    "log_name" TEXT,
    "description" TEXT NOT NULL,
    "event" TEXT,
    "properties" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_and_founds" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "ref_no" TEXT,
    "report_date" TIMESTAMP(3),
    "item" TEXT,
    "room" INTEGER,
    "room_founder" INTEGER,
    "owner_item" TEXT,
    "item_status" TEXT,
    "hotel_location" TEXT,
    "folio" TEXT,
    "contact_number" TEXT,
    "founder_of_item" TEXT,
    "folio_founder" TEXT,
    "contact_number_founder" TEXT,
    "item_description" TEXT,
    "instruction" TEXT,
    "additional_information" TEXT,
    "photo_1" TEXT,
    "photo_2" TEXT,
    "photo_3" TEXT,
    "photo_4" TEXT,
    "photo_5" TEXT,
    "status_lost" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lost_and_founds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_logs" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "date" TIMESTAMP(3),
    "data" TEXT,
    "count" INTEGER,

    CONSTRAINT "map_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_hotel_competitors" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" TEXT,
    "longitude" TEXT,
    "radius" TEXT,
    "property_id" BIGINT,
    "description" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "master_hotel_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" BIGSERIAL NOT NULL,
    "parent_id" BIGINT,
    "model_type" TEXT,
    "model_id" BIGINT,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "visibility" TEXT,
    "uri_table" TEXT,
    "type_table" TEXT,
    "target" INTEGER NOT NULL DEFAULT 0,
    "media" TEXT,
    "data" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "left" INTEGER NOT NULL DEFAULT 0,
    "right" INTEGER NOT NULL DEFAULT 0,
    "child_type" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "message" TEXT NOT NULL,
    "from_name" TEXT NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "closed_by" BIGINT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "migration" TEXT NOT NULL,
    "batch" INTEGER NOT NULL,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_has_code_items" (
    "model_type" TEXT NOT NULL,
    "code_item_id" BIGINT,
    "model_id" BIGINT NOT NULL,
    "data" TEXT,
    "is_posting" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "sales" DECIMAL(65,30),
    "process_on" TEXT,
    "code_post_id" INTEGER,
    "name" TEXT,
    "upsales" TEXT,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "model_has_companies" (
    "company_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_companies_pkey" PRIMARY KEY ("company_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_company_profiles" (
    "company_profile_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "model_has_company_profiles_pkey" PRIMARY KEY ("company_profile_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_menus" (
    "menu_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_menus_pkey" PRIMARY KEY ("menu_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_packages" (
    "package_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "model_has_packages_pkey" PRIMARY KEY ("package_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_permissions" (
    "permission_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_permissions_pkey" PRIMARY KEY ("permission_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_promotions" (
    "promotion_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_promotions_pkey" PRIMARY KEY ("promotion_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_properties" (
    "property_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_properties_pkey" PRIMARY KEY ("property_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_rate_inclusives" (
    "rate_inclusive_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_rate_inclusives_pkey" PRIMARY KEY ("rate_inclusive_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_rates" (
    "rate_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,
    "status" BIGINT NOT NULL DEFAULT 0,
    "temp_status" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "model_has_rates_pkey" PRIMARY KEY ("rate_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_roles" (
    "role_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_roles_pkey" PRIMARY KEY ("role_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_rosters" (
    "roster_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_rosters_pkey" PRIMARY KEY ("roster_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "model_has_types" (
    "type_id" BIGINT NOT NULL,
    "model_type" TEXT NOT NULL,
    "model_id" BIGINT NOT NULL,

    CONSTRAINT "model_has_types_pkey" PRIMARY KEY ("type_id","model_id","model_type")
);

-- CreateTable
CREATE TABLE "other_guests" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "guest_profile_id" BIGINT NOT NULL,
    "folio_id" INTEGER NOT NULL,
    "status_other_guest" INTEGER,
    "check_in_date" TIMESTAMP(3),
    "check_out_date" TIMESTAMP(3),
    "stay" INTEGER,
    "status" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "other_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overbookings" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "overbooking" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "overbookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "sort" TEXT DEFAULT '0',
    "package_type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_matrices" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "payment_xendit_type" TEXT NOT NULL,
    "payment_type_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "payment_matrices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "guard_name" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "tokenable_type" TEXT NOT NULL,
    "tokenable_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "abilities" TEXT,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_book_groups" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "group" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "sort" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "phone_book_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_books" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "phone_book_group_id" BIGINT NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "telp" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "contact_name" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "phone_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_matrix_sales" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "code_post_id" BIGINT,
    "sales_category" TEXT,
    "sales_shift" TEXT,
    "menu_group" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "pos_matrix_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_code_budgets" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "year" INTEGER NOT NULL,
    "code_post_id" BIGINT NOT NULL,
    "month" INTEGER NOT NULL,
    "budget" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "post_code_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "promotion_type" TEXT,
    "promotion_code" TEXT,
    "description" TEXT,
    "from_stay_date" TIMESTAMP(3),
    "to_stay_date" TIMESTAMP(3),
    "from_validity_date" TIMESTAMP(3),
    "to_validity_date" TIMESTAMP(3),
    "no_of_night_discount" INTEGER DEFAULT 0,
    "discount_percentage" INTEGER DEFAULT 0,
    "discount_flat" INTEGER DEFAULT 0,
    "min_night" INTEGER DEFAULT 0,
    "apply_to_every_min_night" BOOLEAN NOT NULL DEFAULT false,
    "rules" TEXT DEFAULT '0',
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" BIGSERIAL NOT NULL,
    "client_uid" TEXT,
    "auth_token" TEXT,
    "url_chart_of_account" TEXT,
    "ip_pos" TEXT,
    "port_pos_night_audit" TEXT,
    "port_pos_gl_code" TEXT,
    "port_pos_posting_code" TEXT,
    "region" TEXT,
    "latitude" TEXT,
    "longitude" TEXT,
    "country_id" BIGINT,
    "city_id" BIGINT,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "bank_account_no" TEXT,
    "bank_name" TEXT,
    "slug" TEXT,
    "whatsapp" TEXT,
    "sync" TEXT,
    "telp" BIGINT,
    "fax" BIGINT,
    "email" TEXT,
    "email_confirmation_bcc" TEXT,
    "image" TEXT,
    "logo" TEXT,
    "address" TEXT,
    "subscribe_type" BOOLEAN NOT NULL DEFAULT false,
    "contract_expired" TIMESTAMP(3) NOT NULL,
    "join_date" TIMESTAMP(3) NOT NULL,
    "is_tax" INTEGER NOT NULL DEFAULT 0,
    "is_tax_exclude_room" INTEGER NOT NULL DEFAULT 0,
    "is_tax_exclude_restaurant" INTEGER NOT NULL DEFAULT 0,
    "ip_doorlock" TEXT,
    "ip_whitelist" TEXT,
    "market_segment_1" BOOLEAN NOT NULL DEFAULT true,
    "market_segment_2" BOOLEAN NOT NULL DEFAULT true,
    "market_segment_3" BOOLEAN NOT NULL DEFAULT true,
    "market_segment_4" BOOLEAN NOT NULL DEFAULT true,
    "source" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "pb1_account_uid" BIGINT,
    "service_charge_account_uid" BIGINT,
    "tax_account_uid" BIGINT,
    "surcharge_account_uid" BIGINT,
    "advance_deposit_current_day_account_uid" BIGINT,
    "advance_deposit_previous_day_account_uid" BIGINT,
    "guest_ledger_current_day_account_uid" BIGINT,
    "guest_ledger_previous_day_account_uid" BIGINT,
    "day_use_item_code" BIGINT,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_configs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT,
    "rate_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "image" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "rate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_day_uses" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "rate_id" BIGINT,
    "name" TEXT NOT NULL,
    "time" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_day_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_extra_bed_inclusives" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "rate_id" BIGINT NOT NULL,
    "description" TEXT,
    "stock" TEXT,
    "frequency" TEXT,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "cost_on" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_extra_bed_inclusives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_inclusives" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "rate_id" BIGINT NOT NULL,
    "description" TEXT,
    "stock" TEXT,
    "frequency" TEXT,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "cost_on" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_inclusives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_link_listings" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT,
    "room_type_id" BIGINT,
    "rate_id" BIGINT,
    "amount" INTEGER,
    "type" TEXT,
    "offsetAdult1" INTEGER,
    "offsetAdult2" INTEGER,
    "offsetExtraAdult" INTEGER,
    "offsetExtraChild" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER DEFAULT 0,
    "status" TEXT,

    CONSTRAINT "rate_link_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_rates" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "rate_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "one_adult" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "two_adult" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "extra_adult" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "extra_child" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "min_night" INTEGER NOT NULL DEFAULT 0,
    "max_night" INTEGER NOT NULL DEFAULT 0,
    "stop_arrival" INTEGER NOT NULL DEFAULT 0,
    "stop_departure" INTEGER NOT NULL DEFAULT 0,
    "stop_sell" INTEGER NOT NULL DEFAULT 0,
    "min_los" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rates" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "module" TEXT NOT NULL DEFAULT 'rate',
    "code_post_id" BIGINT NOT NULL,
    "code_post_extra_bed_id" BIGINT,
    "name" TEXT,
    "code" TEXT NOT NULL,
    "online" INTEGER NOT NULL DEFAULT 0,
    "staah" BOOLEAN NOT NULL DEFAULT false,
    "print_rate" INTEGER NOT NULL DEFAULT 0,
    "min_advance_booking" INTEGER NOT NULL DEFAULT 0,
    "max_advance_booking" INTEGER NOT NULL DEFAULT 0,
    "sync_online" INTEGER NOT NULL DEFAULT 0,
    "sync_staah" BOOLEAN NOT NULL DEFAULT true,
    "is_day_use" BOOLEAN NOT NULL DEFAULT false,
    "minimum_rate" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "grouping" TEXT,
    "description" TEXT,
    "rate_type" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "term_condition" TEXT,
    "cancellation_policy" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "translations" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flag" BOOLEAN NOT NULL DEFAULT true,
    "wikiDataId" TEXT,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_pax_room_solds" (
    "id" BIGSERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year_room_sold" INTEGER,
    "last_year_forecast_rev" DECIMAL(65,30),
    "last_year_pax" INTEGER,

    CONSTRAINT "report_pax_room_solds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_permissions" (
    "id" BIGSERIAL NOT NULL,
    "role_id" BIGINT NOT NULL,
    "property_id" BIGINT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "report_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_breakfast" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_breakfast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_dine_in" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_dine_in_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_fb_other" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_fb_other_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_fb_others" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_fb_others_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_minimarts" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_minimarts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_room_banquet_others" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "code" TEXT,
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_room_banquet_others_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_revenue_room_services" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3),
    "last_year" DECIMAL(65,30),

    CONSTRAINT "report_revenue_room_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" SERIAL NOT NULL,
    "request_id" TEXT NOT NULL,
    "property_id" INTEGER NOT NULL,
    "method" TEXT,
    "data" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_items" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "reservation_id" BIGINT NOT NULL,
    "type" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "code_post_id" BIGINT,
    "code_item_id" BIGINT,
    "description" TEXT,
    "amount" DECIMAL(65,30),
    "total" DECIMAL(65,30),
    "type_amount" TEXT DEFAULT 'PLUS',
    "pb1" DECIMAL(65,30),
    "svr_chrg" DECIMAL(65,30),
    "surcharge" DECIMAL(65,30),
    "tax3" DECIMAL(65,30),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_rate_histories" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "rate_id" BIGINT,
    "rate_name" TEXT,
    "amount" DECIMAL(65,30),
    "service_charge" DECIMAL(65,30),
    "pb1" DECIMAL(65,30),
    "tax3" DECIMAL(65,30),
    "total" DECIMAL(65,30),
    "room_id" BIGINT,
    "room_name" TEXT,
    "room_type_id" BIGINT,
    "room_type_name" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "reservation_rate_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" BIGSERIAL NOT NULL,
    "package_id" BIGINT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "is_extra_day_use" INTEGER NOT NULL DEFAULT 0,
    "quantity_extra_day_use" INTEGER NOT NULL DEFAULT 0,
    "is_24_hour" INTEGER NOT NULL DEFAULT 0,
    "property_id" BIGINT NOT NULL,
    "company_profile_id" BIGINT,
    "company_profile_name" TEXT,
    "rate_id" BIGINT,
    "folio_id" BIGINT NOT NULL,
    "adult" INTEGER,
    "child" INTEGER,
    "add_bed" INTEGER,
    "room_type_id" BIGINT,
    "room_type_name" TEXT,
    "room_type_id_next" BIGINT,
    "room_id" BIGINT,
    "room_name" TEXT,
    "room_status_name" TEXT,
    "maid_status_name" TEXT,
    "room_id_next" BIGINT,
    "check_in_date" TIMESTAMP(3),
    "check_out_date" TIMESTAMP(3),
    "rate_name" TEXT,
    "promo_code" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "eta" TIMESTAMP(3),
    "etd" TIMESTAMP(3),
    "ata" TIMESTAMP(3),
    "atd" TIMESTAMP(3),
    "status_reservation" INTEGER DEFAULT 0,
    "data" TEXT,
    "amountt" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "service_charge" DECIMAL(65,30) DEFAULT 0.0000,
    "pb1" DECIMAL(65,30) DEFAULT 0.0000,
    "tax3" DECIMAL(65,30) DEFAULT 0.0000,
    "total" DECIMAL(65,30) DEFAULT 0.0000,
    "amount_extra_bed" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "service_charge_extra_bed" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "pb1_extra_bed" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "tax3_extra_bed" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "total_extra_bed" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "remark" TEXT,
    "is_posting" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "night" INTEGER NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_menu_crud" (
    "role_id" BIGINT NOT NULL,
    "menu_id" BIGINT NOT NULL,
    "view" BOOLEAN NOT NULL DEFAULT false,
    "add" BOOLEAN NOT NULL DEFAULT false,
    "edit" BOOLEAN NOT NULL DEFAULT false,
    "delete" BOOLEAN NOT NULL DEFAULT false,
    "transaction_actions" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_menu_crud_pkey" PRIMARY KEY ("role_id","menu_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "permission_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("permission_id","role_id")
);

-- CreateTable
CREATE TABLE "role_templates" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "dashboard" TEXT,
    "grants" TEXT,
    "transaction_grants" TEXT,
    "color_ring" TEXT,
    "color_bg" TEXT,
    "color_badge_bg" TEXT,
    "color_badge_text" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_by" BIGINT,

    CONSTRAINT "role_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "guard_name" TEXT NOT NULL,
    "display_name" TEXT,
    "list_dashboard" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_allotments" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "allotment_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "data" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_allotments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_availabilities" (
    "id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "room_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "uniqueCode" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" BIGINT DEFAULT 0,

    CONSTRAINT "room_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_change_histories" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "folio_number" TEXT NOT NULL,
    "check_in_date" TIMESTAMP(3) NOT NULL,
    "check_out_date" TIMESTAMP(3) NOT NULL,
    "from_room_id" BIGINT NOT NULL,
    "from_room_type_id" BIGINT NOT NULL,
    "to_room_id" BIGINT NOT NULL,
    "to_room_type_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "room_change_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_inventories" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "room_id" BIGINT NOT NULL,
    "code_item_id" BIGINT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_image" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "room_type_id" BIGINT,
    "image" TEXT,

    CONSTRAINT "room_type_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "specification" TEXT,
    "is_physical" BOOLEAN NOT NULL DEFAULT true,
    "rate" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "min_rate" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "room_id" BIGINT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_physical" BOOLEAN NOT NULL DEFAULT true,
    "phone_ext" TEXT,
    "map_id" TEXT,
    "max_pax" INTEGER NOT NULL DEFAULT 0,
    "total_bed" INTEGER NOT NULL DEFAULT 0,
    "with_tv" INTEGER NOT NULL DEFAULT 0,
    "with_shower" INTEGER NOT NULL DEFAULT 0,
    "cleaning_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linen_days" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "room_status" INTEGER NOT NULL DEFAULT 0,
    "maid_status" INTEGER NOT NULL DEFAULT 0,
    "address_code" TEXT,
    "last_check_in_date" TIMESTAMP(3),
    "last_check_in_time" TIMESTAMP(3),
    "last_check_out_date" TIMESTAMP(3),
    "last_check_out_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_list" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "name" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "shift_id" INTEGER,
    "date_from" TIMESTAMP(3),
    "date_to" TIMESTAMP(3),

    CONSTRAINT "roster_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosters" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "roster_list_id" INTEGER,
    "shift_id" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "user_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3),
    "is_assigned" INTEGER,

    CONSTRAINT "rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_employees" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "roster_id" BIGINT,
    "date" TIMESTAMP(3),
    "user_id" BIGINT,
    "status" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "schedule_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_postings" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "folio_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "check_in_date" TIMESTAMP(3) NOT NULL,
    "check_out_date" TIMESTAMP(3) NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "item_description" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "confirmation" TEXT NOT NULL,
    "status_posting" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shift_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_roster" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "name" TEXT,
    "time_start" TIMESTAMP(3),
    "time_end" TIMESTAMP(3),
    "time_ranges" JSONB,
    "overtime_start" TIMESTAMP(3),
    "overtime_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "description" TEXT,
    "users" TEXT,

    CONSTRAINT "shift_roster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_user_list" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "shift_roster_id" BIGINT,
    "roster_list_id" BIGINT,
    "roster_date" TIMESTAMP(3),
    "date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,
    "user_id" BIGINT,

    CONSTRAINT "shift_user_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "date" TIMESTAMP(3) NOT NULL,
    "is_posting" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_interfaces" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "hotel_type" TEXT NOT NULL DEFAULT 'Hotel',
    "language_code" TEXT NOT NULL DEFAULT 'en',
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "hotel_info" TEXT,
    "hotel_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "data" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staah_interfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_ota_company_mappings" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "staah_interface_id" BIGINT,
    "channel_id" TEXT NOT NULL,
    "company_profile_id" BIGINT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "staah_ota_company_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_rate_mappings" (
    "id" BIGSERIAL NOT NULL,
    "staah_interface_id" BIGINT NOT NULL,
    "rate_id" BIGINT NOT NULL,
    "staah_rate_plan_id" TEXT,
    "meal_plan_id" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'active',
    "data" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staah_rate_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_reservations" (
    "id" BIGSERIAL NOT NULL,
    "staah_interface_id" BIGINT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "notification_id" TEXT,
    "status" TEXT,
    "guest_name" TEXT,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "check_in_date" TIMESTAMP(3),
    "check_out_date" TIMESTAMP(3),
    "room_id" TEXT,
    "rate_plan_id" TEXT,
    "room_type_id" BIGINT,
    "rate_id" BIGINT,
    "folio_id" BIGINT,
    "reservation_id" BIGINT,
    "payload" JSONB,
    "mapped_data" JSONB,
    "message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "staah_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_room_content_breakdowns" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "staah_interface_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "adult" INTEGER NOT NULL,
    "child" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staah_room_content_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_room_mappings" (
    "id" BIGSERIAL NOT NULL,
    "staah_interface_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "staah_room_id" TEXT,
    "max_occupancy" INTEGER NOT NULL DEFAULT 2,
    "max_child_occupancy" INTEGER NOT NULL DEFAULT 1,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "size_measurement" DECIMAL(65,30),
    "size_measurement_unit" TEXT NOT NULL DEFAULT 'sqm',
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "address_line" TEXT,
    "city_name" TEXT,
    "country_name" TEXT NOT NULL DEFAULT 'ID',
    "postal_code" TEXT,
    "description" TEXT,
    "room_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "data" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staah_room_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staah_sync_logs" (
    "id" BIGSERIAL NOT NULL,
    "staah_interface_id" BIGINT,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'push',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "hotel_id" TEXT,
    "booking_id" TEXT,
    "room_id" TEXT,
    "rate_plan_id" TEXT,
    "date_from" TIMESTAMP(3),
    "date_to" TIMESTAMP(3),
    "payload" JSONB,
    "response" JSONB,
    "message" TEXT,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "staah_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" BIGINT NOT NULL,
    "country_code" TEXT NOT NULL,
    "fips_code" TEXT,
    "iso2" TEXT,
    "type" TEXT,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flag" BOOLEAN NOT NULL DEFAULT true,
    "wikiDataId" TEXT,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statistic_messages" (
    "id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "statistic_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statistic_rate_codes" (
    "id" SERIAL NOT NULL,
    "property_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "statistic_rate_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "code" TEXT,
    "stock" INTEGER,
    "post_gl_id" BIGINT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stop_sells" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "room_type_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,

    CONSTRAINT "stop_sells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subregions" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "translations" TEXT,
    "region_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flag" BOOLEAN NOT NULL DEFAULT true,
    "wikiDataId" TEXT,

    CONSTRAINT "subregions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_balances" (
    "id" SERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "code_id" BIGINT NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3),
    "name" TEXT,
    "type" TEXT,
    "debit" DECIMAL(65,30),
    "credit" DECIMAL(65,30),

    CONSTRAINT "system_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reads" (
    "id" BIGSERIAL NOT NULL,
    "task_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" BIGSERIAL NOT NULL,
    "created_by" BIGINT NOT NULL,
    "to_user_id" BIGINT,
    "to_role_id" BIGINT,
    "department" TEXT,
    "room_number" TEXT,
    "type" TEXT NOT NULL,
    "status" "tasks_status" DEFAULT 'Open',
    "created_on" TIMESTAMP(3),
    "duration" TIMESTAMP(3),
    "message" TEXT,
    "priority" "tasks_priority" DEFAULT 'Medium',
    "is_read" INTEGER DEFAULT 0,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "parent_id" BIGINT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_party_logs" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "text" TEXT,

    CONSTRAINT "third_party_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_breakdowns" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "type" TEXT,
    "uuid" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "type_payment_id" BIGINT,
    "rate_inclusive_id" BIGINT,
    "code_item_id" BIGINT,
    "description" TEXT,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "type_amount" TEXT DEFAULT 'PLUS',
    "pb1" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "svr_chrg" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "surcharge" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "tax3" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "closing" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "overwrite_reason" TEXT,
    "time" TIMESTAMP(3),
    "bill_to" TEXT,
    "model_type" TEXT,
    "model_id" BIGINT,
    "void_code" TEXT,
    "reference" TEXT,
    "pos" TEXT,
    "receipt" TEXT,
    "card_name" TEXT,
    "last_digit_card" INTEGER,
    "remark" TEXT,
    "voucher" TEXT,
    "booking" TEXT,
    "folio_id" BIGINT NOT NULL,
    "is_posting" INTEGER NOT NULL DEFAULT 0,
    "is_endshift" INTEGER NOT NULL DEFAULT 0,
    "is_void" INTEGER NOT NULL DEFAULT 0,
    "is_transfer" INTEGER NOT NULL DEFAULT 0,
    "is_consolidate" INTEGER NOT NULL DEFAULT 0,
    "is_split" INTEGER NOT NULL DEFAULT 0,
    "is_has_inclusive" INTEGER NOT NULL DEFAULT 0,
    "data" TEXT,
    "frequency" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transaction_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_pos_details" (
    "id" BIGSERIAL NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "data" TEXT,

    CONSTRAINT "transaction_pos_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_temps" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "type_amount" TEXT,
    "folio_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "code" BIGINT NOT NULL,
    "code_item_id" BIGINT,
    "description" TEXT,
    "overwrite_reason" TEXT,
    "time" TEXT,
    "bill_to" INTEGER,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "gst" DECIMAL(65,30),
    "pb1" DECIMAL(65,30),
    "svr_chrg" DECIMAL(65,30),
    "rate" DECIMAL(65,30),
    "surcharge" DECIMAL(65,30),
    "tax3" DECIMAL(65,30),
    "total" DECIMAL(65,30),
    "reference" TEXT,
    "pos" TEXT,
    "receipt" TEXT,
    "last_digit_card" TEXT,
    "card_name" TEXT,
    "remark" TEXT,
    "voucher" TEXT,
    "booking" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER DEFAULT 0,

    CONSTRAINT "transaction_temps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT,
    "uuid" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "code_name" TEXT,
    "type_payment_id" BIGINT,
    "type_payment_name" TEXT,
    "code_item_id" BIGINT,
    "code_item_name" TEXT,
    "description" TEXT,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "type_amount" TEXT DEFAULT 'PLUS',
    "pb1" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "svr_chrg" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "surcharge" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "tax3" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "overwrite_reason" TEXT,
    "time" TIMESTAMP(3),
    "bill_to" TEXT,
    "model_type" TEXT,
    "model_id" BIGINT,
    "void_code" TEXT,
    "reference" TEXT,
    "pos" TEXT,
    "receipt" TEXT,
    "card_name" TEXT,
    "last_digit_card" INTEGER,
    "remark" TEXT,
    "voucher" TEXT,
    "booking" TEXT,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "pos_matrix_sales_id" BIGINT,
    "is_posting" INTEGER NOT NULL DEFAULT 0,
    "is_event_deposit" INTEGER NOT NULL DEFAULT 0,
    "is_endshift" INTEGER NOT NULL DEFAULT 0,
    "is_end_of_day" INTEGER NOT NULL DEFAULT 0,
    "is_void" INTEGER NOT NULL DEFAULT 0,
    "is_transfer" INTEGER NOT NULL DEFAULT 0,
    "is_consolidate" INTEGER NOT NULL DEFAULT 0,
    "is_split" INTEGER NOT NULL DEFAULT 0,
    "is_has_inclusive" INTEGER NOT NULL DEFAULT 0,
    "is_pos_deposit" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'hms',
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "type_payments" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "code_post_id" BIGINT NOT NULL,
    "code_billing_id" BIGINT,
    "name" TEXT NOT NULL,
    "uuid" TEXT,
    "company_id" INTEGER,
    "pos" INTEGER,
    "front_office" INTEGER,
    "card_no" BOOLEAN,
    "card_name" BOOLEAN,
    "voucher" BOOLEAN,
    "is_company_ar" BOOLEAN,
    "is_payment_ar" BOOLEAN,
    "booking_no" INTEGER,
    "surcharge_type" INTEGER NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(65,30) NOT NULL DEFAULT 0.0000,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "type_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "types" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "group" TEXT,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "text" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "last_login_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "password" TEXT NOT NULL,
    "password_changed_at" TIMESTAMP(3),
    "remember_token" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "force_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_property" BIGINT,
    "pin_enshift" INTEGER,
    "fcm_token" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wake_up_calls" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "folio_id" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TIMESTAMP(3),
    "description" TEXT,
    "result" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,

    CONSTRAINT "wake_up_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_stocks" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "work_order_id" BIGINT,
    "stock_id" BIGINT,
    "description" TEXT,
    "qty" INTEGER,
    "post_gl_id" BIGINT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_order_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT,
    "reported_by" BIGINT,
    "unique_code" TEXT,
    "area" TEXT,
    "work_type" TEXT,
    "date" TIMESTAMP(3),
    "estimated_time" TIMESTAMP(3),
    "room_id" BIGINT,
    "work_description" TEXT,
    "notes" TEXT,
    "assign_to" BIGINT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "start_time" TEXT,
    "end_time" TEXT,
    "status_work_order" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "updated_by" BIGINT,
    "deleted_by" BIGINT,
    "images" TEXT,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yields" (
    "id" BIGSERIAL NOT NULL,
    "property_id" BIGINT NOT NULL,
    "is_general" INTEGER NOT NULL,
    "room_type_id" BIGINT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "min_rate" DECIMAL(65,30) NOT NULL,
    "occupancy_from" INTEGER NOT NULL,
    "occupancy_to" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "yields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accountings_folio_id_idx" ON "accountings"("folio_id");

-- CreateIndex
CREATE INDEX "accountings_property_id_idx" ON "accountings"("property_id");

-- CreateIndex
CREATE INDEX "accountings_type_payment_id_idx" ON "accountings"("type_payment_id");

-- CreateIndex
CREATE INDEX "allotments_model_id_model_type_idx" ON "allotments"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "allotments_property_id_idx" ON "allotments"("property_id");

-- CreateIndex
CREATE INDEX "baggages_property_id_idx" ON "baggages"("property_id");

-- CreateIndex
CREATE INDEX "batch_report_property_id_idx" ON "batch_report"("property_id");

-- CreateIndex
CREATE INDEX "billing_tos_billing_code_idx" ON "billing_tos"("billing_code");

-- CreateIndex
CREATE INDEX "billing_tos_folio_id_idx" ON "billing_tos"("folio_id");

-- CreateIndex
CREATE INDEX "billing_tos_model_id_model_type_idx" ON "billing_tos"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "billing_tos_property_id_idx" ON "billing_tos"("property_id");

-- CreateIndex
CREATE INDEX "cancelation_rule_dates_cancelation_rule_id_idx" ON "cancelation_rule_dates"("cancelation_rule_id");

-- CreateIndex
CREATE INDEX "car_parks_property_id_idx" ON "car_parks"("property_id");

-- CreateIndex
CREATE INDEX "channel_manager_rate_plans_channel_manager_interface_id_idx" ON "channel_manager_rate_plans"("channel_manager_interface_id");

-- CreateIndex
CREATE INDEX "channel_manager_rate_plans_property_id_idx" ON "channel_manager_rate_plans"("property_id");

-- CreateIndex
CREATE INDEX "channel_manager_rate_plans_rate_id_idx" ON "channel_manager_rate_plans"("rate_id");

-- CreateIndex
CREATE INDEX "channel_manager_room_types_channel_manager_interface_id_idx" ON "channel_manager_room_types"("channel_manager_interface_id");

-- CreateIndex
CREATE INDEX "channel_manager_room_types_room_type_idx" ON "channel_manager_room_types"("room_type");

-- CreateIndex
CREATE INDEX "channel_manager_room_types_room_type_id_idx" ON "channel_manager_room_types"("room_type_id");

-- CreateIndex
CREATE INDEX "cities_state_id_idx" ON "cities"("state_id");

-- CreateIndex
CREATE INDEX "cities_country_id_idx" ON "cities"("country_id");

-- CreateIndex
CREATE INDEX "code_billings_property_id_idx" ON "code_billings"("property_id");

-- CreateIndex
CREATE INDEX "code_gls_property_id_idx" ON "code_gls"("property_id");

-- CreateIndex
CREATE INDEX "code_items_code_post_id_idx" ON "code_items"("code_post_id");

-- CreateIndex
CREATE INDEX "code_items_property_id_idx" ON "code_items"("property_id");

-- CreateIndex
CREATE INDEX "code_posts_code_billing_id_idx" ON "code_posts"("code_billing_id");

-- CreateIndex
CREATE INDEX "code_posts_code_gl_id_idx" ON "code_posts"("code_gl_id");

-- CreateIndex
CREATE INDEX "code_posts_property_id_idx" ON "code_posts"("property_id");

-- CreateIndex
CREATE INDEX "companies_created_by_idx" ON "companies"("created_by");

-- CreateIndex
CREATE INDEX "companies_updated_by_idx" ON "companies"("updated_by");

-- CreateIndex
CREATE INDEX "company_profile_activities_property_id_idx" ON "company_profile_activities"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_ar_transactions_company_profile_id_idx" ON "company_profile_ar_transactions"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_ar_transactions_property_id_idx" ON "company_profile_ar_transactions"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_billing_setups_code_billing_id_idx" ON "company_profile_billing_setups"("code_billing_id");

-- CreateIndex
CREATE INDEX "company_profile_billing_setups_company_profile_id_idx" ON "company_profile_billing_setups"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_billing_setups_property_id_idx" ON "company_profile_billing_setups"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_contact_persons_company_profile_id_idx" ON "company_profile_contact_persons"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_contact_persons_property_id_idx" ON "company_profile_contact_persons"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_customed_onlines_company_profile_id_idx" ON "company_profile_customed_onlines"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_customed_onlines_property_id_idx" ON "company_profile_customed_onlines"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_departments_city_id_idx" ON "company_profile_departments"("city_id");

-- CreateIndex
CREATE INDEX "company_profile_departments_company_profile_id_idx" ON "company_profile_departments"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_departments_country_id_idx" ON "company_profile_departments"("country_id");

-- CreateIndex
CREATE INDEX "company_profile_departments_property_id_idx" ON "company_profile_departments"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_documents_company_profile_id_idx" ON "company_profile_documents"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_documents_property_id_idx" ON "company_profile_documents"("property_id");

-- CreateIndex
CREATE INDEX "company_profile_statistics_company_profile_id_idx" ON "company_profile_statistics"("company_profile_id");

-- CreateIndex
CREATE INDEX "company_profile_statistics_property_id_idx" ON "company_profile_statistics"("property_id");

-- CreateIndex
CREATE INDEX "company_profiles_code_billing_id_idx" ON "company_profiles"("code_billing_id");

-- CreateIndex
CREATE INDEX "company_profiles_property_id_idx" ON "company_profiles"("property_id");

-- CreateIndex
CREATE INDEX "company_profiles_name_idx" ON "company_profiles"("name");

-- CreateIndex
CREATE INDEX "company_profiles_type_company_idx" ON "company_profiles"("type_company");

-- CreateIndex
CREATE INDEX "content_banners_property_id_idx" ON "content_banners"("property_id");

-- CreateIndex
CREATE INDEX "content_optional_items_content_room_id_idx" ON "content_optional_items"("content_room_id");

-- CreateIndex
CREATE INDEX "content_room_breakdowns_content_room_id_idx" ON "content_room_breakdowns"("content_room_id");

-- CreateIndex
CREATE INDEX "content_room_facilities_content_room_id_idx" ON "content_room_facilities"("content_room_id");

-- CreateIndex
CREATE INDEX "content_room_images_content_room_id_idx" ON "content_room_images"("content_room_id");

-- CreateIndex
CREATE INDEX "content_rooms_property_id_idx" ON "content_rooms"("property_id");

-- CreateIndex
CREATE INDEX "contents_property_id_idx" ON "contents"("property_id");

-- CreateIndex
CREATE INDEX "countries_region_id_idx" ON "countries"("region_id");

-- CreateIndex
CREATE INDEX "countries_subregion_id_idx" ON "countries"("subregion_id");

-- CreateIndex
CREATE INDEX "deposit_events_folio_id_idx" ON "deposit_events"("folio_id");

-- CreateIndex
CREATE INDEX "deposit_events_property_id_idx" ON "deposit_events"("property_id");

-- CreateIndex
CREATE INDEX "deposit_events_type_payment_id_idx" ON "deposit_events"("type_payment_id");

-- CreateIndex
CREATE INDEX "deposit_payments_folio_id_idx" ON "deposit_payments"("folio_id");

-- CreateIndex
CREATE INDEX "deposit_payments_property_id_idx" ON "deposit_payments"("property_id");

-- CreateIndex
CREATE INDEX "deposit_payments_payment_type_idx" ON "deposit_payments"("payment_type");

-- CreateIndex
CREATE INDEX "doorlock_configs_created_at_idx" ON "doorlock_configs"("created_at");

-- CreateIndex
CREATE INDEX "doorlock_configs_checkin_idx" ON "doorlock_configs"("checkin");

-- CreateIndex
CREATE INDEX "doorlock_configs_checkout_idx" ON "doorlock_configs"("checkout");

-- CreateIndex
CREATE INDEX "doorlock_configs_is_assign_idx" ON "doorlock_configs"("is_assign");

-- CreateIndex
CREATE INDEX "doorlock_configs_property_id_idx" ON "doorlock_configs"("property_id");

-- CreateIndex
CREATE INDEX "doorlock_configs_roomcode_idx" ON "doorlock_configs"("roomcode");

-- CreateIndex
CREATE INDEX "doorlock_configs_property_id_is_assign_idx" ON "doorlock_configs"("property_id", "is_assign");

-- CreateIndex
CREATE INDEX "doorlock_configs_property_id_roomcode_idx" ON "doorlock_configs"("property_id", "roomcode");

-- CreateIndex
CREATE INDEX "doorlock_duplicate_counters_created_at_idx" ON "doorlock_duplicate_counters"("created_at");

-- CreateIndex
CREATE INDEX "doorlock_duplicate_counters_folio_id_idx" ON "doorlock_duplicate_counters"("folio_id");

-- CreateIndex
CREATE INDEX "doorlock_duplicate_counters_property_id_idx" ON "doorlock_duplicate_counters"("property_id");

-- CreateIndex
CREATE INDEX "doorlock_duplicate_counters_property_id_folio_id_idx" ON "doorlock_duplicate_counters"("property_id", "folio_id");

-- CreateIndex
CREATE INDEX "dynamic_rate_configs_property_id_idx" ON "dynamic_rate_configs"("property_id");

-- CreateIndex
CREATE INDEX "dynamic_rate_results_dynamic_rate_config_id_idx" ON "dynamic_rate_results"("dynamic_rate_config_id");

-- CreateIndex
CREATE INDEX "dynamic_rate_results_room_type_id_idx" ON "dynamic_rate_results"("room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "dynamic_rate_results_property_id_dynamic_rate_config_id_roo_key" ON "dynamic_rate_results"("property_id", "dynamic_rate_config_id", "room_type_id", "date");

-- CreateIndex
CREATE INDEX "email_builders_property_id_idx" ON "email_builders"("property_id");

-- CreateIndex
CREATE INDEX "email_groups_property_id_idx" ON "email_groups"("property_id");

-- CreateIndex
CREATE INDEX "event_capacities_layout_id_idx" ON "event_capacities"("layout_id");

-- CreateIndex
CREATE INDEX "event_capacities_venue_id_idx" ON "event_capacities"("venue_id");

-- CreateIndex
CREATE INDEX "event_deposit_actuals_event_id_idx" ON "event_deposit_actuals"("event_id");

-- CreateIndex
CREATE INDEX "event_deposit_plans_event_id_idx" ON "event_deposit_plans"("event_id");

-- CreateIndex
CREATE INDEX "event_event_items_event_id_idx" ON "event_event_items"("event_id");

-- CreateIndex
CREATE INDEX "event_events_company_profile_id_idx" ON "event_events"("company_profile_id");

-- CreateIndex
CREATE INDEX "event_events_folio_id_idx" ON "event_events"("folio_id");

-- CreateIndex
CREATE INDEX "event_events_layout_id_idx" ON "event_events"("layout_id");

-- CreateIndex
CREATE INDEX "event_events_package_id_idx" ON "event_events"("package_id");

-- CreateIndex
CREATE INDEX "event_events_property_id_idx" ON "event_events"("property_id");

-- CreateIndex
CREATE INDEX "event_events_venue_id_idx" ON "event_events"("venue_id");

-- CreateIndex
CREATE INDEX "event_instructions_event_id_idx" ON "event_instructions"("event_id");

-- CreateIndex
CREATE INDEX "event_package_items_package_id_idx" ON "event_package_items"("package_id");

-- CreateIndex
CREATE INDEX "event_packages_capacity_id_idx" ON "event_packages"("capacity_id");

-- CreateIndex
CREATE INDEX "event_packages_layout_id_idx" ON "event_packages"("layout_id");

-- CreateIndex
CREATE INDEX "event_packages_venue_id_idx" ON "event_packages"("venue_id");

-- CreateIndex
CREATE INDEX "event_venues_layouts_layout_id_idx" ON "event_venues_layouts"("layout_id");

-- CreateIndex
CREATE UNIQUE INDEX "uuid" ON "failed_jobs"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "folio_number" ON "folios"("folio_number");

-- CreateIndex
CREATE INDEX "folios_booking_agent_id_idx" ON "folios"("booking_agent_id");

-- CreateIndex
CREATE INDEX "folios_company_profile_id_idx" ON "folios"("company_profile_id");

-- CreateIndex
CREATE INDEX "folios_contact_person_id_idx" ON "folios"("contact_person_id");

-- CreateIndex
CREATE INDEX "folios_guest_profile_id_idx" ON "folios"("guest_profile_id");

-- CreateIndex
CREATE INDEX "folios_guest_profile_id_status_reservation_property_id_dele_idx" ON "folios"("guest_profile_id", "status_reservation", "property_id", "deleted_at");

-- CreateIndex
CREATE INDEX "folios_is_house_use_complimentary_check_in_date_check_out_d_idx" ON "folios"("is_house_use", "complimentary", "check_in_date", "check_out_date");

-- CreateIndex
CREATE INDEX "folios_id_status_reservation_type_reservation_property_id_d_idx" ON "folios"("id", "status_reservation", "type_reservation", "property_id", "deleted_at");

-- CreateIndex
CREATE INDEX "folios_is_payment_booking_engine_idx" ON "folios"("is_payment_booking_engine");

-- CreateIndex
CREATE INDEX "folios_property_id_idx" ON "folios"("property_id");

-- CreateIndex
CREATE INDEX "folios_status_reservation_idx" ON "folios"("status_reservation");

-- CreateIndex
CREATE INDEX "guest_profile_documents_guest_profile_id_idx" ON "guest_profile_documents"("guest_profile_id");

-- CreateIndex
CREATE INDEX "guest_profile_documents_property_id_idx" ON "guest_profile_documents"("property_id");

-- CreateIndex
CREATE INDEX "guest_profile_family_members_guest_profile_id_idx" ON "guest_profile_family_members"("guest_profile_id");

-- CreateIndex
CREATE INDEX "guest_profile_family_members_has_guest_profile_id_idx" ON "guest_profile_family_members"("has_guest_profile_id");

-- CreateIndex
CREATE INDEX "guest_profile_family_members_property_id_idx" ON "guest_profile_family_members"("property_id");

-- CreateIndex
CREATE INDEX "guest_profile_histories_id_guest_profile_idx" ON "guest_profile_histories"("id_guest_profile");

-- CreateIndex
CREATE INDEX "guest_profile_histories_property_id_idx" ON "guest_profile_histories"("property_id");

-- CreateIndex
CREATE INDEX "guest_profile_loyalty_cards_guest_profile_id_idx" ON "guest_profile_loyalty_cards"("guest_profile_id");

-- CreateIndex
CREATE INDEX "guest_profile_loyalty_cards_property_id_idx" ON "guest_profile_loyalty_cards"("property_id");

-- CreateIndex
CREATE INDEX "guest_profile_preferences_property_id_idx" ON "guest_profile_preferences"("property_id");

-- CreateIndex
CREATE INDEX "guest_profile_request_notes_id_guest_profile_idx" ON "guest_profile_request_notes"("id_guest_profile");

-- CreateIndex
CREATE INDEX "guest_profile_request_notes_property_id_idx" ON "guest_profile_request_notes"("property_id");

-- CreateIndex
CREATE INDEX "guest_profile_request_notes_id_guest_profile_property_id_de_idx" ON "guest_profile_request_notes"("id_guest_profile", "property_id", "deleted_at", "status", "id");

-- CreateIndex
CREATE INDEX "guest_profiles_property_id_idx" ON "guest_profiles"("property_id");

-- CreateIndex
CREATE INDEX "guest_profiles_id_property_id_deleted_at_idx" ON "guest_profiles"("id", "property_id", "deleted_at");

-- CreateIndex
CREATE INDEX "holidays_property_id_idx" ON "holidays"("property_id");

-- CreateIndex
CREATE INDEX "hotel_competitors_master_hotel_competitor_id_idx" ON "hotel_competitors"("master_hotel_competitor_id");

-- CreateIndex
CREATE INDEX "housekeeper_history_date_idx" ON "housekeeper_history"("date");

-- CreateIndex
CREATE INDEX "housekeeper_history_date_room_id_done_inspection_idx" ON "housekeeper_history"("date", "room_id", "done_inspection");

-- CreateIndex
CREATE INDEX "housekeeper_history_done_inspection_idx" ON "housekeeper_history"("done_inspection");

-- CreateIndex
CREATE INDEX "housekeeper_history_property_id_idx" ON "housekeeper_history"("property_id");

-- CreateIndex
CREATE INDEX "housekeeper_history_room_id_date_done_inspection_idx" ON "housekeeper_history"("room_id", "date", "done_inspection");

-- CreateIndex
CREATE INDEX "housekeeper_history_room_id_idx" ON "housekeeper_history"("room_id");

-- CreateIndex
CREATE INDEX "housekeeper_history_user_housekeeper_history_id_user_id_idx" ON "housekeeper_history_user"("housekeeper_history_id", "user_id");

-- CreateIndex
CREATE INDEX "housekeeper_history_user_housekeeper_history_id_idx" ON "housekeeper_history_user"("housekeeper_history_id");

-- CreateIndex
CREATE INDEX "housekeeper_history_user_user_id_idx" ON "housekeeper_history_user"("user_id");

-- CreateIndex
CREATE INDEX "housekeeper_history_user_property_id_idx" ON "housekeeper_history_user"("property_id");

-- CreateIndex
CREATE INDEX "housekeeping_history_checklists_housekeeping_setup_id_idx" ON "housekeeping_history_checklists"("housekeeping_setup_id");

-- CreateIndex
CREATE INDEX "housekeeping_history_checklists_housekeeper_history_id_idx" ON "housekeeping_history_checklists"("housekeeper_history_id");

-- CreateIndex
CREATE INDEX "housekeeping_setup_room_types_room_type_id_idx" ON "housekeeping_setup_room_types"("room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_setup_room_types_housekeeping_setup_id_room_ty_key" ON "housekeeping_setup_room_types"("housekeeping_setup_id", "room_type_id");

-- CreateIndex
CREATE INDEX "housekeeping_setup_rooms_room_id_idx" ON "housekeeping_setup_rooms"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_setup_rooms_housekeeping_setup_id_room_id_key" ON "housekeeping_setup_rooms"("housekeeping_setup_id", "room_id");

-- CreateIndex
CREATE INDEX "housekeeping_setups_category_idx" ON "housekeeping_setups"("category");

-- CreateIndex
CREATE INDEX "housekeeping_setups_property_id_idx" ON "housekeeping_setups"("property_id");

-- CreateIndex
CREATE INDEX "housekeeping_setups_sort_idx" ON "housekeeping_setups"("sort");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_setups_code_property_id_key" ON "housekeeping_setups"("code", "property_id");

-- CreateIndex
CREATE INDEX "logs_created_at_idx" ON "logs"("created_at");

-- CreateIndex
CREATE INDEX "logs_causer_type_causer_id_idx" ON "logs"("causer_type", "causer_id");

-- CreateIndex
CREATE INDEX "logs_log_name_idx" ON "logs"("log_name");

-- CreateIndex
CREATE INDEX "logs_subject_type_subject_id_idx" ON "logs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "lost_and_founds_property_id_idx" ON "lost_and_founds"("property_id");

-- CreateIndex
CREATE INDEX "menus_model_type_model_id_idx" ON "menus"("model_type", "model_id");

-- CreateIndex
CREATE INDEX "menus_parent_id_left_right_idx" ON "menus"("parent_id", "left", "right");

-- CreateIndex
CREATE INDEX "messages_folio_id_idx" ON "messages"("folio_id");

-- CreateIndex
CREATE INDEX "messages_property_id_idx" ON "messages"("property_id");

-- CreateIndex
CREATE INDEX "model_has_code_items_model_id_idx" ON "model_has_code_items"("model_id");

-- CreateIndex
CREATE INDEX "model_has_code_items_model_type_idx" ON "model_has_code_items"("model_type");

-- CreateIndex
CREATE INDEX "model_has_companies_model_id_idx" ON "model_has_companies"("model_id");

-- CreateIndex
CREATE INDEX "model_has_companies_model_type_idx" ON "model_has_companies"("model_type");

-- CreateIndex
CREATE INDEX "model_has_company_profiles_model_id_idx" ON "model_has_company_profiles"("model_id");

-- CreateIndex
CREATE INDEX "model_has_company_profiles_model_type_idx" ON "model_has_company_profiles"("model_type");

-- CreateIndex
CREATE INDEX "model_has_menus_model_id_model_type_idx" ON "model_has_menus"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "model_has_packages_model_id_idx" ON "model_has_packages"("model_id");

-- CreateIndex
CREATE INDEX "model_has_packages_model_type_idx" ON "model_has_packages"("model_type");

-- CreateIndex
CREATE INDEX "model_has_permissions_model_id_model_type_idx" ON "model_has_permissions"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "model_has_promotions_model_id_idx" ON "model_has_promotions"("model_id");

-- CreateIndex
CREATE INDEX "model_has_promotions_model_type_idx" ON "model_has_promotions"("model_type");

-- CreateIndex
CREATE INDEX "model_has_properties_model_id_model_type_idx" ON "model_has_properties"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "model_has_rate_inclusives_model_id_model_type_idx" ON "model_has_rate_inclusives"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "model_has_rates_model_id_idx" ON "model_has_rates"("model_id");

-- CreateIndex
CREATE INDEX "model_has_rates_model_type_idx" ON "model_has_rates"("model_type");

-- CreateIndex
CREATE INDEX "model_has_roles_model_id_model_type_idx" ON "model_has_roles"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "model_has_rosters_model_id_model_type_idx" ON "model_has_rosters"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "model_has_types_type_id_idx" ON "model_has_types"("type_id");

-- CreateIndex
CREATE INDEX "model_has_types_model_id_model_type_type_id_idx" ON "model_has_types"("model_id", "model_type", "type_id");

-- CreateIndex
CREATE INDEX "model_has_types_model_id_model_type_idx" ON "model_has_types"("model_id", "model_type");

-- CreateIndex
CREATE INDEX "other_guests_guest_profile_id_idx" ON "other_guests"("guest_profile_id");

-- CreateIndex
CREATE INDEX "other_guests_property_id_idx" ON "other_guests"("property_id");

-- CreateIndex
CREATE INDEX "overbookings_property_id_idx" ON "overbookings"("property_id");

-- CreateIndex
CREATE INDEX "overbookings_room_type_id_idx" ON "overbookings"("room_type_id");

-- CreateIndex
CREATE INDEX "packages_property_id_idx" ON "packages"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_guard_name_key" ON "permissions"("name", "guard_name");

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_token_unique" ON "personal_access_tokens"("token");

-- CreateIndex
CREATE INDEX "personal_access_tokens_tokenable_type_tokenable_id_idx" ON "personal_access_tokens"("tokenable_type", "tokenable_id");

-- CreateIndex
CREATE INDEX "phone_book_groups_parent_id_idx" ON "phone_book_groups"("parent_id");

-- CreateIndex
CREATE INDEX "phone_book_groups_property_id_idx" ON "phone_book_groups"("property_id");

-- CreateIndex
CREATE INDEX "phone_books_phone_book_group_id_idx" ON "phone_books"("phone_book_group_id");

-- CreateIndex
CREATE INDEX "phone_books_property_id_idx" ON "phone_books"("property_id");

-- CreateIndex
CREATE INDEX "pos_matrix_sales_code_post_id_idx" ON "pos_matrix_sales"("code_post_id");

-- CreateIndex
CREATE INDEX "promotions_property_id_idx" ON "promotions"("property_id");

-- CreateIndex
CREATE INDEX "properties_city_id_idx" ON "properties"("city_id");

-- CreateIndex
CREATE INDEX "rate_configs_rate_id_idx" ON "rate_configs"("rate_id");

-- CreateIndex
CREATE INDEX "rate_day_uses_sort_idx" ON "rate_day_uses"("sort");

-- CreateIndex
CREATE INDEX "rate_day_uses_status_idx" ON "rate_day_uses"("status");

-- CreateIndex
CREATE INDEX "rate_day_uses_rate_id_idx" ON "rate_day_uses"("rate_id");

-- CreateIndex
CREATE INDEX "rate_extra_bed_inclusives_property_id_idx" ON "rate_extra_bed_inclusives"("property_id");

-- CreateIndex
CREATE INDEX "rate_extra_bed_inclusives_rate_id_idx" ON "rate_extra_bed_inclusives"("rate_id");

-- CreateIndex
CREATE INDEX "rate_inclusives_property_id_idx" ON "rate_inclusives"("property_id");

-- CreateIndex
CREATE INDEX "rate_inclusives_rate_id_idx" ON "rate_inclusives"("rate_id");

-- CreateIndex
CREATE INDEX "rate_rates_rate_id_room_type_id_date_idx" ON "rate_rates"("rate_id", "room_type_id", "date");

-- CreateIndex
CREATE INDEX "rate_rates_rate_id_room_type_id_date_property_id_idx" ON "rate_rates"("rate_id", "room_type_id", "date", "property_id");

-- CreateIndex
CREATE INDEX "rate_rates_property_id_idx" ON "rate_rates"("property_id");

-- CreateIndex
CREATE INDEX "rate_rates_rate_id_idx" ON "rate_rates"("rate_id");

-- CreateIndex
CREATE INDEX "rate_rates_room_type_id_idx" ON "rate_rates"("room_type_id");

-- CreateIndex
CREATE INDEX "rates_id_property_id_deleted_at_idx" ON "rates"("id", "property_id", "deleted_at");

-- CreateIndex
CREATE INDEX "rates_online_sync_online_idx" ON "rates"("online", "sync_online");

-- CreateIndex
CREATE INDEX "rates_code_post_id_idx" ON "rates"("code_post_id");

-- CreateIndex
CREATE INDEX "rates_property_id_idx" ON "rates"("property_id");

-- CreateIndex
CREATE INDEX "report_permissions_property_id_idx" ON "report_permissions"("property_id");

-- CreateIndex
CREATE INDEX "report_permissions_role_id_idx" ON "report_permissions"("role_id");

-- CreateIndex
CREATE INDEX "report_permissions_status_idx" ON "report_permissions"("status");

-- CreateIndex
CREATE INDEX "requests_status_idx" ON "requests"("status");

-- CreateIndex
CREATE INDEX "reservation_items_property_id_idx" ON "reservation_items"("property_id");

-- CreateIndex
CREATE INDEX "reservation_rate_histories_room_name_idx" ON "reservation_rate_histories"("room_name");

-- CreateIndex
CREATE INDEX "reservation_rate_histories_room_type_name_idx" ON "reservation_rate_histories"("room_type_name");

-- CreateIndex
CREATE INDEX "reservations_company_profile_id_idx" ON "reservations"("company_profile_id");

-- CreateIndex
CREATE INDEX "reservations_date_idx" ON "reservations"("date");

-- CreateIndex
CREATE INDEX "reservations_folio_id_idx" ON "reservations"("folio_id");

-- CreateIndex
CREATE INDEX "reservations_date_property_id_idx" ON "reservations"("date", "property_id");

-- CreateIndex
CREATE INDEX "reservations_deleted_at_idx" ON "reservations"("deleted_at");

-- CreateIndex
CREATE INDEX "reservations_package_id_idx" ON "reservations"("package_id");

-- CreateIndex
CREATE INDEX "reservations_property_id_idx" ON "reservations"("property_id");

-- CreateIndex
CREATE INDEX "reservations_rate_id_idx" ON "reservations"("rate_id");

-- CreateIndex
CREATE INDEX "reservations_room_id_idx" ON "reservations"("room_id");

-- CreateIndex
CREATE INDEX "reservations_room_id_next_idx" ON "reservations"("room_id_next");

-- CreateIndex
CREATE INDEX "reservations_room_type_id_idx" ON "reservations"("room_type_id");

-- CreateIndex
CREATE INDEX "reservations_room_type_id_next_idx" ON "reservations"("room_type_id_next");

-- CreateIndex
CREATE INDEX "role_menu_crud_menu_id_idx" ON "role_menu_crud"("menu_id");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_templates_key_property_id_key" ON "role_templates"("key", "property_id");

-- CreateIndex
CREATE INDEX "room_allotments_allotment_id_idx" ON "room_allotments"("allotment_id");

-- CreateIndex
CREATE INDEX "room_allotments_property_id_idx" ON "room_allotments"("property_id");

-- CreateIndex
CREATE INDEX "room_allotments_room_type_id_idx" ON "room_allotments"("room_type_id");

-- CreateIndex
CREATE INDEX "room_inventories_code_item_id_idx" ON "room_inventories"("code_item_id");

-- CreateIndex
CREATE INDEX "room_inventories_property_id_idx" ON "room_inventories"("property_id");

-- CreateIndex
CREATE INDEX "room_inventories_room_id_idx" ON "room_inventories"("room_id");

-- CreateIndex
CREATE INDEX "room_type_image_property_id_idx" ON "room_type_image"("property_id");

-- CreateIndex
CREATE INDEX "room_types_property_id_idx" ON "room_types"("property_id");

-- CreateIndex
CREATE INDEX "rooms_is_physical_idx" ON "rooms"("is_physical");

-- CreateIndex
CREATE INDEX "rooms_is_physical_maid_status_idx" ON "rooms"("is_physical", "maid_status");

-- CreateIndex
CREATE INDEX "rooms_is_physical_room_status_idx" ON "rooms"("is_physical", "room_status");

-- CreateIndex
CREATE INDEX "rooms_is_physical_room_type_id_idx" ON "rooms"("is_physical", "room_type_id");

-- CreateIndex
CREATE INDEX "rooms_maid_status_idx" ON "rooms"("maid_status");

-- CreateIndex
CREATE INDEX "rooms_name_idx" ON "rooms"("name");

-- CreateIndex
CREATE INDEX "rooms_room_status_idx" ON "rooms"("room_status");

-- CreateIndex
CREATE INDEX "rooms_room_type_id_idx" ON "rooms"("room_type_id");

-- CreateIndex
CREATE INDEX "rooms_property_id_idx" ON "rooms"("property_id");

-- CreateIndex
CREATE INDEX "rooms_room_id_idx" ON "rooms"("room_id");

-- CreateIndex
CREATE INDEX "roster_list_property_id_idx" ON "roster_list"("property_id");

-- CreateIndex
CREATE INDEX "rosters_date_idx" ON "rosters"("date");

-- CreateIndex
CREATE INDEX "rosters_date_shift_id_idx" ON "rosters"("date", "shift_id");

-- CreateIndex
CREATE INDEX "rosters_shift_id_idx" ON "rosters"("shift_id");

-- CreateIndex
CREATE INDEX "rosters_property_id_idx" ON "rosters"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "rosters_property_id_user_id_date_shift_id_key" ON "rosters"("property_id", "user_id", "date", "shift_id");

-- CreateIndex
CREATE INDEX "schedule_employees_property_id_idx" ON "schedule_employees"("property_id");

-- CreateIndex
CREATE INDEX "schedule_employees_roster_id_idx" ON "schedule_employees"("roster_id");

-- CreateIndex
CREATE INDEX "schedule_employees_user_id_idx" ON "schedule_employees"("user_id");

-- CreateIndex
CREATE INDEX "shift_postings_property_id_idx" ON "shift_postings"("property_id");

-- CreateIndex
CREATE INDEX "shift_postings_room_type_id_idx" ON "shift_postings"("room_type_id");

-- CreateIndex
CREATE INDEX "shift_postings_user_id_idx" ON "shift_postings"("user_id");

-- CreateIndex
CREATE INDEX "shift_roster_time_end_idx" ON "shift_roster"("time_end");

-- CreateIndex
CREATE INDEX "shift_roster_time_start_time_end_idx" ON "shift_roster"("time_start", "time_end");

-- CreateIndex
CREATE INDEX "shift_roster_time_start_idx" ON "shift_roster"("time_start");

-- CreateIndex
CREATE INDEX "shift_roster_property_id_idx" ON "shift_roster"("property_id");

-- CreateIndex
CREATE INDEX "shift_user_list_shift_roster_id_property_id_idx" ON "shift_user_list"("shift_roster_id", "property_id");

-- CreateIndex
CREATE INDEX "shift_user_list_shift_roster_id_idx" ON "shift_user_list"("shift_roster_id");

-- CreateIndex
CREATE INDEX "shift_user_list_user_id_idx" ON "shift_user_list"("user_id");

-- CreateIndex
CREATE INDEX "shift_user_list_roster_date_idx" ON "shift_user_list"("roster_date");

-- CreateIndex
CREATE INDEX "shift_user_list_roster_date_shift_roster_id_idx" ON "shift_user_list"("roster_date", "shift_roster_id");

-- CreateIndex
CREATE INDEX "shift_user_list_property_id_idx" ON "shift_user_list"("property_id");

-- CreateIndex
CREATE INDEX "shifts_property_id_idx" ON "shifts"("property_id");

-- CreateIndex
CREATE INDEX "shifts_user_id_idx" ON "shifts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_id" ON "staah_interfaces"("hotel_id");

-- CreateIndex
CREATE INDEX "staah_interfaces_property_id_idx" ON "staah_interfaces"("property_id");

-- CreateIndex
CREATE INDEX "staah_ota_company_mappings_company_profile_id_idx" ON "staah_ota_company_mappings"("company_profile_id");

-- CreateIndex
CREATE INDEX "staah_ota_company_mappings_staah_interface_id_idx" ON "staah_ota_company_mappings"("staah_interface_id");

-- CreateIndex
CREATE INDEX "staah_ota_company_mappings_property_id_idx" ON "staah_ota_company_mappings"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "staah_ota_company_mappings_property_id_channel_id_key" ON "staah_ota_company_mappings"("property_id", "channel_id");

-- CreateIndex
CREATE INDEX "staah_rate_mappings_rate_id_idx" ON "staah_rate_mappings"("rate_id");

-- CreateIndex
CREATE INDEX "staah_rate_mappings_staah_interface_id_idx" ON "staah_rate_mappings"("staah_interface_id");

-- CreateIndex
CREATE INDEX "staah_reservations_booking_id_idx" ON "staah_reservations"("booking_id");

-- CreateIndex
CREATE INDEX "staah_reservations_folio_id_idx" ON "staah_reservations"("folio_id");

-- CreateIndex
CREATE INDEX "staah_reservations_hotel_id_idx" ON "staah_reservations"("hotel_id");

-- CreateIndex
CREATE INDEX "staah_reservations_notification_id_idx" ON "staah_reservations"("notification_id");

-- CreateIndex
CREATE INDEX "staah_reservations_rate_id_idx" ON "staah_reservations"("rate_id");

-- CreateIndex
CREATE INDEX "staah_reservations_rate_plan_id_idx" ON "staah_reservations"("rate_plan_id");

-- CreateIndex
CREATE INDEX "staah_reservations_reservation_id_idx" ON "staah_reservations"("reservation_id");

-- CreateIndex
CREATE INDEX "staah_reservations_room_id_idx" ON "staah_reservations"("room_id");

-- CreateIndex
CREATE INDEX "staah_reservations_room_type_id_idx" ON "staah_reservations"("room_type_id");

-- CreateIndex
CREATE INDEX "staah_reservations_status_idx" ON "staah_reservations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "staah_reservations_staah_interface_id_booking_id_key" ON "staah_reservations"("staah_interface_id", "booking_id");

-- CreateIndex
CREATE INDEX "staah_room_content_breakdowns_property_id_idx" ON "staah_room_content_breakdowns"("property_id");

-- CreateIndex
CREATE INDEX "staah_room_content_breakdowns_staah_interface_id_room_type__idx" ON "staah_room_content_breakdowns"("staah_interface_id", "room_type_id");

-- CreateIndex
CREATE INDEX "staah_room_content_breakdowns_room_type_id_idx" ON "staah_room_content_breakdowns"("room_type_id");

-- CreateIndex
CREATE INDEX "staah_room_content_breakdowns_staah_interface_id_idx" ON "staah_room_content_breakdowns"("staah_interface_id");

-- CreateIndex
CREATE INDEX "staah_room_mappings_room_type_id_idx" ON "staah_room_mappings"("room_type_id");

-- CreateIndex
CREATE INDEX "staah_room_mappings_staah_interface_id_idx" ON "staah_room_mappings"("staah_interface_id");

-- CreateIndex
CREATE INDEX "staah_sync_logs_booking_id_idx" ON "staah_sync_logs"("booking_id");

-- CreateIndex
CREATE INDEX "staah_sync_logs_hotel_id_idx" ON "staah_sync_logs"("hotel_id");

-- CreateIndex
CREATE INDEX "staah_sync_logs_staah_interface_id_idx" ON "staah_sync_logs"("staah_interface_id");

-- CreateIndex
CREATE INDEX "staah_sync_logs_status_idx" ON "staah_sync_logs"("status");

-- CreateIndex
CREATE INDEX "staah_sync_logs_type_idx" ON "staah_sync_logs"("type");

-- CreateIndex
CREATE INDEX "states_country_id_idx" ON "states"("country_id");

-- CreateIndex
CREATE INDEX "stocks_post_gl_id_idx" ON "stocks"("post_gl_id");

-- CreateIndex
CREATE INDEX "stocks_property_id_idx" ON "stocks"("property_id");

-- CreateIndex
CREATE INDEX "subregions_region_id_idx" ON "subregions"("region_id");

-- CreateIndex
CREATE INDEX "system_balances_code_id_idx" ON "system_balances"("code_id");

-- CreateIndex
CREATE INDEX "system_balances_date_idx" ON "system_balances"("date");

-- CreateIndex
CREATE INDEX "system_balances_property_id_idx" ON "system_balances"("property_id");

-- CreateIndex
CREATE INDEX "system_balances_type_idx" ON "system_balances"("type");

-- CreateIndex
CREATE INDEX "task_reads_user_id_read_at_idx" ON "task_reads"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_reads_task_id_user_id_key" ON "task_reads"("task_id", "user_id");

-- CreateIndex
CREATE INDEX "tasks_created_by_idx" ON "tasks"("created_by");

-- CreateIndex
CREATE INDEX "tasks_created_on_idx" ON "tasks"("created_on");

-- CreateIndex
CREATE INDEX "tasks_department_idx" ON "tasks"("department");

-- CreateIndex
CREATE INDEX "tasks_parent_id_idx" ON "tasks"("parent_id");

-- CreateIndex
CREATE INDEX "tasks_priority_idx" ON "tasks"("priority");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_to_role_id_idx" ON "tasks"("to_role_id");

-- CreateIndex
CREATE INDEX "tasks_to_user_id_idx" ON "tasks"("to_user_id");

-- CreateIndex
CREATE INDEX "tasks_type_idx" ON "tasks"("type");

-- CreateIndex
CREATE INDEX "transaction_breakdowns_folio_id_idx" ON "transaction_breakdowns"("folio_id");

-- CreateIndex
CREATE INDEX "transaction_breakdowns_property_id_idx" ON "transaction_breakdowns"("property_id");

-- CreateIndex
CREATE INDEX "transaction_breakdowns_transaction_id_idx" ON "transaction_breakdowns"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_breakdowns_type_payment_id_idx" ON "transaction_breakdowns"("type_payment_id");

-- CreateIndex
CREATE INDEX "transaction_temps_folio_id_idx" ON "transaction_temps"("folio_id");

-- CreateIndex
CREATE INDEX "transaction_temps_property_id_idx" ON "transaction_temps"("property_id");

-- CreateIndex
CREATE INDEX "transactions_code_idx" ON "transactions"("code");

-- CreateIndex
CREATE INDEX "transactions_code_item_id_idx" ON "transactions"("code_item_id");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_folio_id_idx" ON "transactions"("folio_id");

-- CreateIndex
CREATE INDEX "transactions_model_id_idx" ON "transactions"("model_id");

-- CreateIndex
CREATE INDEX "transactions_model_type_idx" ON "transactions"("model_type");

-- CreateIndex
CREATE INDEX "transactions_property_id_idx" ON "transactions"("property_id");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_type_payment_id_idx" ON "transactions"("type_payment_id");

-- CreateIndex
CREATE INDEX "type_payments_code_post_id_idx" ON "type_payments"("code_post_id");

-- CreateIndex
CREATE INDEX "type_payments_property_id_idx" ON "type_payments"("property_id");

-- CreateIndex
CREATE INDEX "types_group_name_deleted_at_property_id_idx" ON "types"("group", "name", "deleted_at", "property_id");

-- CreateIndex
CREATE INDEX "types_group_id_idx" ON "types"("group", "id");

-- CreateIndex
CREATE INDEX "types_id_name_group_property_id_deleted_at_idx" ON "types"("id", "name", "group", "property_id", "deleted_at");

-- CreateIndex
CREATE INDEX "types_group_idx" ON "types"("group");

-- CreateIndex
CREATE INDEX "types_property_id_idx" ON "types"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_unique" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users"("name");

-- CreateIndex
CREATE INDEX "wake_up_calls_folio_id_idx" ON "wake_up_calls"("folio_id");

-- CreateIndex
CREATE INDEX "wake_up_calls_property_id_idx" ON "wake_up_calls"("property_id");

-- CreateIndex
CREATE INDEX "work_order_stocks_post_gl_id_idx" ON "work_order_stocks"("post_gl_id");

-- CreateIndex
CREATE INDEX "work_order_stocks_property_id_idx" ON "work_order_stocks"("property_id");

-- CreateIndex
CREATE INDEX "work_order_stocks_stock_id_idx" ON "work_order_stocks"("stock_id");

-- CreateIndex
CREATE INDEX "work_order_stocks_work_order_id_idx" ON "work_order_stocks"("work_order_id");

-- CreateIndex
CREATE INDEX "work_orders_assign_to_idx" ON "work_orders"("assign_to");

-- CreateIndex
CREATE INDEX "work_orders_property_id_idx" ON "work_orders"("property_id");

-- CreateIndex
CREATE INDEX "work_orders_room_id_idx" ON "work_orders"("room_id");

-- CreateIndex
CREATE INDEX "work_orders_reported_by_idx" ON "work_orders"("reported_by");

-- CreateIndex
CREATE INDEX "yields_room_type_id_idx" ON "yields"("room_type_id");

-- AddForeignKey
ALTER TABLE "accountings" ADD CONSTRAINT "accountings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accountings" ADD CONSTRAINT "accountings_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accountings" ADD CONSTRAINT "accountings_type_payment_id_fkey" FOREIGN KEY ("type_payment_id") REFERENCES "type_payments"("id") ON DELETE NO ACTION ON UPDATE SET NULL;

-- AddForeignKey
ALTER TABLE "allotments" ADD CONSTRAINT "allotments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "baggages" ADD CONSTRAINT "baggages_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_tos" ADD CONSTRAINT "billing_tos_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_tos" ADD CONSTRAINT "billing_tos_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_tos" ADD CONSTRAINT "billing_tos_billing_code_fkey" FOREIGN KEY ("billing_code") REFERENCES "code_billings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cancelation_rule_dates" ADD CONSTRAINT "cancelation_rule_dates_cancelation_rule_id_fkey" FOREIGN KEY ("cancelation_rule_id") REFERENCES "cancelation_rules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "car_parks" ADD CONSTRAINT "car_parks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "channel_manager_rate_plans" ADD CONSTRAINT "channel_manager_rate_plans_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "channel_manager_rate_plans" ADD CONSTRAINT "channel_manager_rate_plans_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "channel_manager_rate_plans" ADD CONSTRAINT "channel_manager_rate_plans_channel_manager_interface_id_fkey" FOREIGN KEY ("channel_manager_interface_id") REFERENCES "channel_manager_interfaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "channel_manager_room_types" ADD CONSTRAINT "channel_manager_room_types_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "channel_manager_room_types" ADD CONSTRAINT "channel_manager_room_types_room_type_fkey" FOREIGN KEY ("room_type") REFERENCES "room_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "channel_manager_room_types" ADD CONSTRAINT "channel_manager_room_types_channel_manager_interface_id_fkey" FOREIGN KEY ("channel_manager_interface_id") REFERENCES "channel_manager_interfaces"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "code_billings" ADD CONSTRAINT "code_billings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "code_gls" ADD CONSTRAINT "code_gls_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "code_items" ADD CONSTRAINT "code_items_code_post_id_fkey" FOREIGN KEY ("code_post_id") REFERENCES "code_posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "code_items" ADD CONSTRAINT "code_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "code_posts" ADD CONSTRAINT "code_posts_code_billing_id_fkey" FOREIGN KEY ("code_billing_id") REFERENCES "code_billings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "code_posts" ADD CONSTRAINT "code_posts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_activities" ADD CONSTRAINT "company_profile_activities_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_ar_transactions" ADD CONSTRAINT "company_profile_ar_transactions_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_ar_transactions" ADD CONSTRAINT "company_profile_ar_transactions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_billing_setups" ADD CONSTRAINT "company_profile_billing_setups_code_billing_id_fkey" FOREIGN KEY ("code_billing_id") REFERENCES "code_billings"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_billing_setups" ADD CONSTRAINT "company_profile_billing_setups_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_billing_setups" ADD CONSTRAINT "company_profile_billing_setups_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_contact_persons" ADD CONSTRAINT "company_profile_contact_persons_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_contact_persons" ADD CONSTRAINT "company_profile_contact_persons_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_customed_onlines" ADD CONSTRAINT "company_profile_customed_onlines_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_customed_onlines" ADD CONSTRAINT "company_profile_customed_onlines_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_departments" ADD CONSTRAINT "company_profile_departments_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_departments" ADD CONSTRAINT "company_profile_departments_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_departments" ADD CONSTRAINT "company_profile_departments_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_departments" ADD CONSTRAINT "company_profile_departments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_documents" ADD CONSTRAINT "company_profile_documents_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_documents" ADD CONSTRAINT "company_profile_documents_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_statistics" ADD CONSTRAINT "company_profile_statistics_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profile_statistics" ADD CONSTRAINT "company_profile_statistics_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_room_breakdowns" ADD CONSTRAINT "content_room_breakdowns_content_room_id_fkey" FOREIGN KEY ("content_room_id") REFERENCES "content_rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_room_facilities" ADD CONSTRAINT "content_room_facilities_content_room_id_fkey" FOREIGN KEY ("content_room_id") REFERENCES "content_rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_room_images" ADD CONSTRAINT "content_room_images_content_room_id_fkey" FOREIGN KEY ("content_room_id") REFERENCES "content_rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_subregion_id_fkey" FOREIGN KEY ("subregion_id") REFERENCES "subregions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deposit_payments" ADD CONSTRAINT "deposit_payments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deposit_payments" ADD CONSTRAINT "deposit_payments_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doorlock_duplicate_counters" ADD CONSTRAINT "doorlock_duplicate_counters_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doorlock_duplicate_counters" ADD CONSTRAINT "doorlock_duplicate_counters_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dynamic_rate_configs" ADD CONSTRAINT "dynamic_rate_configs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dynamic_rate_results" ADD CONSTRAINT "dynamic_rate_results_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dynamic_rate_results" ADD CONSTRAINT "dynamic_rate_results_dynamic_rate_config_id_fkey" FOREIGN KEY ("dynamic_rate_config_id") REFERENCES "dynamic_rate_configs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dynamic_rate_results" ADD CONSTRAINT "dynamic_rate_results_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event_capacities" ADD CONSTRAINT "event_capacities_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "event_venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_capacities" ADD CONSTRAINT "event_capacities_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "event_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deposit_actuals" ADD CONSTRAINT "event_deposit_actuals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deposit_plans" ADD CONSTRAINT "event_deposit_plans_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_events" ADD CONSTRAINT "event_events_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_events" ADD CONSTRAINT "event_events_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_events" ADD CONSTRAINT "event_events_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "event_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_events" ADD CONSTRAINT "event_events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "event_venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_events" ADD CONSTRAINT "event_events_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "event_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_instructions" ADD CONSTRAINT "event_instructions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_package_items" ADD CONSTRAINT "event_package_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "event_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_packages" ADD CONSTRAINT "event_packages_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "event_venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_packages" ADD CONSTRAINT "event_packages_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "event_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_venues_layouts" ADD CONSTRAINT "event_venues_layouts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "event_venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_venues_layouts" ADD CONSTRAINT "event_venues_layouts_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "event_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "folios" ADD CONSTRAINT "folios_booking_agent_id_fkey" FOREIGN KEY ("booking_agent_id") REFERENCES "company_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_documents" ADD CONSTRAINT "guest_profile_documents_guest_profile_id_fkey" FOREIGN KEY ("guest_profile_id") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_documents" ADD CONSTRAINT "guest_profile_documents_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_family_members" ADD CONSTRAINT "guest_profile_family_members_guest_profile_id_fkey" FOREIGN KEY ("guest_profile_id") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_family_members" ADD CONSTRAINT "guest_profile_family_members_has_guest_profile_id_fkey" FOREIGN KEY ("has_guest_profile_id") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_family_members" ADD CONSTRAINT "guest_profile_family_members_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_histories" ADD CONSTRAINT "guest_profile_histories_id_guest_profile_fkey" FOREIGN KEY ("id_guest_profile") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_histories" ADD CONSTRAINT "guest_profile_histories_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_loyalty_cards" ADD CONSTRAINT "guest_profile_loyalty_cards_guest_profile_id_fkey" FOREIGN KEY ("guest_profile_id") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_loyalty_cards" ADD CONSTRAINT "guest_profile_loyalty_cards_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_preferences" ADD CONSTRAINT "guest_profile_preferences_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_request_notes" ADD CONSTRAINT "guest_profile_request_notes_id_guest_profile_fkey" FOREIGN KEY ("id_guest_profile") REFERENCES "guest_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profile_request_notes" ADD CONSTRAINT "guest_profile_request_notes_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "guest_profiles" ADD CONSTRAINT "guest_profiles_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "hotel_competitors" ADD CONSTRAINT "hotel_competitors_master_hotel_competitor_id_fkey" FOREIGN KEY ("master_hotel_competitor_id") REFERENCES "master_hotel_competitors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeper_history" ADD CONSTRAINT "housekeeper_history_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeping_history_checklists" ADD CONSTRAINT "housekeeping_history_checklists_housekeeper_history_id_fkey" FOREIGN KEY ("housekeeper_history_id") REFERENCES "housekeeper_history"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeping_history_checklists" ADD CONSTRAINT "housekeeping_history_checklists_housekeeping_setup_id_fkey" FOREIGN KEY ("housekeeping_setup_id") REFERENCES "housekeeping_setups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeping_setup_room_types" ADD CONSTRAINT "housekeeping_setup_room_types_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeping_setup_room_types" ADD CONSTRAINT "housekeeping_setup_room_types_housekeeping_setup_id_fkey" FOREIGN KEY ("housekeeping_setup_id") REFERENCES "housekeeping_setups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeping_setup_rooms" ADD CONSTRAINT "housekeeping_setup_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "housekeeping_setup_rooms" ADD CONSTRAINT "housekeeping_setup_rooms_housekeeping_setup_id_fkey" FOREIGN KEY ("housekeeping_setup_id") REFERENCES "housekeeping_setups"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lost_and_founds" ADD CONSTRAINT "lost_and_founds_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_companies" ADD CONSTRAINT "model_has_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_company_profiles" ADD CONSTRAINT "model_has_company_profiles_company_profile_id_fkey" FOREIGN KEY ("company_profile_id") REFERENCES "company_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_menus" ADD CONSTRAINT "model_has_menus_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_packages" ADD CONSTRAINT "model_has_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_permissions" ADD CONSTRAINT "model_has_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_promotions" ADD CONSTRAINT "model_has_promotions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_properties" ADD CONSTRAINT "model_has_properties_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_rate_inclusives" ADD CONSTRAINT "model_has_rate_inclusives_rate_inclusive_id_fkey" FOREIGN KEY ("rate_inclusive_id") REFERENCES "rate_inclusives"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_rates" ADD CONSTRAINT "model_has_rates_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_roles" ADD CONSTRAINT "model_has_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_rosters" ADD CONSTRAINT "model_has_rosters_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "rosters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_has_types" ADD CONSTRAINT "model_has_types_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "other_guests" ADD CONSTRAINT "other_guests_guest_profile_id_fkey" FOREIGN KEY ("guest_profile_id") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "other_guests" ADD CONSTRAINT "other_guests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "overbookings" ADD CONSTRAINT "overbookings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "overbookings" ADD CONSTRAINT "overbookings_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_book_groups" ADD CONSTRAINT "phone_book_groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "phone_book_groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_book_groups" ADD CONSTRAINT "phone_book_groups_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_books" ADD CONSTRAINT "phone_books_phone_book_group_id_fkey" FOREIGN KEY ("phone_book_group_id") REFERENCES "phone_book_groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_books" ADD CONSTRAINT "phone_books_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos_matrix_sales" ADD CONSTRAINT "pos_matrix_sales_code_post_id_fkey" FOREIGN KEY ("code_post_id") REFERENCES "code_posts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_day_uses" ADD CONSTRAINT "rate_day_uses_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_extra_bed_inclusives" ADD CONSTRAINT "rate_extra_bed_inclusives_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_extra_bed_inclusives" ADD CONSTRAINT "rate_extra_bed_inclusives_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_inclusives" ADD CONSTRAINT "rate_inclusives_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_inclusives" ADD CONSTRAINT "rate_inclusives_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_rates" ADD CONSTRAINT "rate_rates_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_rates" ADD CONSTRAINT "rate_rates_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_rates" ADD CONSTRAINT "rate_rates_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_code_post_id_fkey" FOREIGN KEY ("code_post_id") REFERENCES "code_posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_menu_crud" ADD CONSTRAINT "role_menu_crud_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_menu_crud" ADD CONSTRAINT "role_menu_crud_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_allotments" ADD CONSTRAINT "room_allotments_allotment_id_fkey" FOREIGN KEY ("allotment_id") REFERENCES "allotments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_allotments" ADD CONSTRAINT "room_allotments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_allotments" ADD CONSTRAINT "room_allotments_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_inventories" ADD CONSTRAINT "room_inventories_code_item_id_fkey" FOREIGN KEY ("code_item_id") REFERENCES "code_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_inventories" ADD CONSTRAINT "room_inventories_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_inventories" ADD CONSTRAINT "room_inventories_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_type_image" ADD CONSTRAINT "room_type_image_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "schedule_employees" ADD CONSTRAINT "schedule_employees_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "schedule_employees" ADD CONSTRAINT "schedule_employees_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "rosters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "schedule_employees" ADD CONSTRAINT "schedule_employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shift_postings" ADD CONSTRAINT "shift_postings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shift_postings" ADD CONSTRAINT "shift_postings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shift_postings" ADD CONSTRAINT "shift_postings_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_interfaces" ADD CONSTRAINT "staah_interfaces_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_rate_mappings" ADD CONSTRAINT "staah_rate_mappings_staah_interface_id_fkey" FOREIGN KEY ("staah_interface_id") REFERENCES "staah_interfaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_rate_mappings" ADD CONSTRAINT "staah_rate_mappings_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_reservations" ADD CONSTRAINT "staah_reservations_staah_interface_id_fkey" FOREIGN KEY ("staah_interface_id") REFERENCES "staah_interfaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_reservations" ADD CONSTRAINT "staah_reservations_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_reservations" ADD CONSTRAINT "staah_reservations_rate_id_fkey" FOREIGN KEY ("rate_id") REFERENCES "rates"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_reservations" ADD CONSTRAINT "staah_reservations_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_reservations" ADD CONSTRAINT "staah_reservations_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_room_content_breakdowns" ADD CONSTRAINT "staah_room_content_breakdowns_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_room_content_breakdowns" ADD CONSTRAINT "staah_room_content_breakdowns_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_room_content_breakdowns" ADD CONSTRAINT "staah_room_content_breakdowns_staah_interface_id_fkey" FOREIGN KEY ("staah_interface_id") REFERENCES "staah_interfaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_room_mappings" ADD CONSTRAINT "staah_room_mappings_staah_interface_id_fkey" FOREIGN KEY ("staah_interface_id") REFERENCES "staah_interfaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_room_mappings" ADD CONSTRAINT "staah_room_mappings_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staah_sync_logs" ADD CONSTRAINT "staah_sync_logs_staah_interface_id_fkey" FOREIGN KEY ("staah_interface_id") REFERENCES "staah_interfaces"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "states" ADD CONSTRAINT "states_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_post_gl_id_fkey" FOREIGN KEY ("post_gl_id") REFERENCES "code_gls"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subregions" ADD CONSTRAINT "subregions_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "task_reads" ADD CONSTRAINT "task_reads_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "task_reads" ADD CONSTRAINT "task_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_to_role_id_fkey" FOREIGN KEY ("to_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_breakdowns" ADD CONSTRAINT "transaction_breakdowns_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_breakdowns" ADD CONSTRAINT "transaction_breakdowns_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_breakdowns" ADD CONSTRAINT "transaction_breakdowns_type_payment_id_fkey" FOREIGN KEY ("type_payment_id") REFERENCES "type_payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_breakdowns" ADD CONSTRAINT "transaction_breakdowns_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_temps" ADD CONSTRAINT "transaction_temps_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transaction_temps" ADD CONSTRAINT "transaction_temps_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_payment_id_fkey" FOREIGN KEY ("type_payment_id") REFERENCES "type_payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "type_payments" ADD CONSTRAINT "type_payments_code_post_id_fkey" FOREIGN KEY ("code_post_id") REFERENCES "code_posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "type_payments" ADD CONSTRAINT "type_payments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "types" ADD CONSTRAINT "types_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "wake_up_calls" ADD CONSTRAINT "wake_up_calls_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "wake_up_calls" ADD CONSTRAINT "wake_up_calls_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_stocks" ADD CONSTRAINT "work_order_stocks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_stocks" ADD CONSTRAINT "work_order_stocks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_stocks" ADD CONSTRAINT "work_order_stocks_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_stocks" ADD CONSTRAINT "work_order_stocks_post_gl_id_fkey" FOREIGN KEY ("post_gl_id") REFERENCES "code_gls"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assign_to_fkey" FOREIGN KEY ("assign_to") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "yields" ADD CONSTRAINT "yields_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
