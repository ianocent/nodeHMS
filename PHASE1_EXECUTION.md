# Phase 1 Execution Guide
## Database Migration & Architecture Setup

**Current Status**: Ready to start

**Prerequisites**:
- ✅ PostgreSQL running on Laragon
- ✅ MySQL running on Laragon  
- ✅ Node.js installed
- ✅ .env configured for Laragon

---

## Step-by-Step Execution

### Step 1: Fix Prisma Schema (Extract from MySQL)

```bash
# Update .env to read from MySQL
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"

# Pull schema from MySQL and generate correct Prisma schema
npm run phase1:schema

# This will:
# - Connect to MySQL
# - Introspect all 186 tables
# - Generate proper Prisma schema with correct syntax
# - Generate Prisma client
```

**Expected Output**:
```
Introspected 186 models from MySQL database
Generated Prisma schema with all models
Generated Prisma client
```

**Time**: ~2 minutes

---

### Step 2: Migrate Schema to PostgreSQL

```bash
# Switch back to PostgreSQL
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"

# Create PostgreSQL tables from Prisma schema
npm run phase1:tables

# This will:
# - Generate SQL migration from schema
# - Apply migration to PostgreSQL
# - Create all 186 tables with correct structure
```

**Expected Output**:
```
Creating migration from current schema
Executing migration
Migration applied successfully
```

**Time**: ~1-2 minutes

---

### Step 3: Install Dependencies

```bash
# Install MySQL connector for data migration script
npm install

# This adds mysql2 to node_modules
```

**Time**: ~3-5 minutes

---

### Step 4: Compile TypeScript

```bash
# Compile scripts to JavaScript
npm run build

# This generates dist/ folder with compiled scripts
```

**Time**: ~1 minute

---

### Step 5: Migrate Data

```bash
# Run data migration from MySQL to PostgreSQL
npm run phase1:data

# This will:
# - Connect to both MySQL and PostgreSQL
# - Read all data from MySQL (186 tables)
# - Insert data into PostgreSQL
# - Handle type conversions (decimal, datetime, etc.)
# - Skip duplicate key errors
# - Report progress
```

**Expected Output**:
```
Found 186 tables to migrate

accountings: 32360 rows migrated
allocation_accountings: 0 rows
... (many more tables) ...

✓ Migration complete: XXXXX total rows migrated
```

**Time**: 5-15 minutes (depends on data volume)

---

### Step 6: Verify Data Integrity

```bash
# Compare row counts between MySQL and PostgreSQL
npm run phase1:verify

# This will:
# - Count rows in each MySQL table
# - Count rows in corresponding PostgreSQL table
# - Compare and report mismatches
# - Exit with error if any mismatch found
```

**Expected Output**:
```
Verifying data migration integrity...

✓ accountings                    MySQL:  32360 → PostgreSQL:  32360
✓ allocation_accountings         MySQL:      0 → PostgreSQL:      0
... (all match) ...

======================================================================
✓ All tables verified successfully!
```

**Time**: ~2 minutes

---

## Troubleshooting

### Issue: "Cannot find module 'mysql2'"
**Solution**: Run `npm install` first

### Issue: "ECONNREFUSED" on MySQL
**Solution**: Ensure Laragon MySQL is running, check credentials in .env

### Issue: "ECONNREFUSED" on PostgreSQL
**Solution**: Ensure Laragon PostgreSQL is running. Check port is 5432

### Issue: Schema pull fails
**Solution**: Check if `.env` has correct MySQL connection string set

### Issue: Data migration leaves empty tables
**Solution**: Check for foreign key constraint violations, see error logs

---

## After Phase 1 Complete

Once all 6 steps are done:

1. PostgreSQL will have all 186 tables with full data
2. Verify no errors in logs
3. Manually spot-check a few tables in PostgreSQL:
   ```bash
   psql -U postgres -h localhost -d hms_anyaman
   hms_anyaman=# SELECT COUNT(*) FROM accountings;
   ```
4. Proceed to Phase 2 (Architecture & Permissions)

---

## Phase 1 Rollback (if needed)

If migration fails and you need to restart:

```bash
# Delete PostgreSQL schema
psql -U postgres -h localhost -d hms_anyaman -c "DROP SCHEMA public CASCADE;"

# Recreate empty schema
psql -U postgres -h localhost -d hms_anyaman -c "CREATE SCHEMA public;"

# Delete migrations folder
rm -rf prisma/migrations

# Start over from Step 1
```

---

## Estimated Timeline

| Step | Time | Cumulative |
|------|------|-----------|
| 1: Schema Extract | 2 min | 2 min |
| 2: PostgreSQL Setup | 2 min | 4 min |
| 3: Dependencies | 5 min | 9 min |
| 4: Build | 1 min | 10 min |
| 5: Data Migration | 10 min | 20 min |
| 6: Verification | 2 min | 22 min |

**Total Phase 1**: ~22 minutes (plus any troubleshooting)

---

## Success Criteria

✅ Phase 1 is complete when:
1. `npm run phase1:verify` shows "All tables verified successfully!"
2. Row counts match exactly between MySQL and PostgreSQL
3. No foreign key constraint errors
4. No data type conversion errors
5. PostgreSQL database is ready for Phase 2

---

**Next**: Once Phase 1 done, start Phase 2 (Core Architecture & Permissions)
