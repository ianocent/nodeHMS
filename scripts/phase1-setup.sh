#!/bin/bash

# HMS Anyaman Phase 1 Setup Script
# Handles schema migration from MySQL to PostgreSQL

set -e

echo "=== Phase 1: Database Migration Setup ==="
echo ""

# Step 1: Pull schema from MySQL using Prisma introspection
echo "[1/4] Extracting schema from MySQL via Prisma..."
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"
npx prisma db pull --skip-generate

if [ $? -eq 0 ]; then
    echo "✓ Schema extracted from MySQL"
else
    echo "✗ Failed to extract schema from MySQL"
    exit 1
fi

echo ""
echo "[2/4] Validating Prisma schema..."
npx prisma validate

if [ $? -eq 0 ]; then
    echo "✓ Prisma schema valid"
else
    echo "✗ Schema validation failed"
    exit 1
fi

# Step 2: Switch to PostgreSQL
echo ""
echo "[3/4] Switching to PostgreSQL and creating tables..."
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
npx prisma migrate dev --name init --skip-generate

if [ $? -eq 0 ]; then
    echo "✓ PostgreSQL tables created"
else
    echo "✗ Failed to create PostgreSQL tables"
    exit 1
fi

# Step 3: Data migration (Node.js script)
echo ""
echo "[4/4] Migrating data from MySQL to PostgreSQL..."
node dist/scripts/migrate-data.js

if [ $? -eq 0 ]; then
    echo "✓ Data migration complete"
else
    echo "✗ Data migration failed"
    exit 1
fi

echo ""
echo "=== Phase 1 Complete ==="
echo "Next step: Run 'npm run verify:data' to validate integrity"
