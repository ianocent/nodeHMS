# HMS Anyaman Backend Migration - Phase 1 Status

**Date**: 2026-07-13  
**Phase**: 1 of 5  
**Status**: 🟡 Ready to Execute

---

## What's Been Prepared

### ✅ Infrastructure
- PostgreSQL database created: `hms_anyaman` (Laragon)
- .env configured for Laragon (no Docker)
- Node.js project initialized with Express + Prisma + TypeScript
- 186 tables identified in MySQL schema (much larger than expected!)

### ✅ Documentation
- `MIGRATION_PLAN.md` - Full 5-phase roadmap
- `PHASE1_EXECUTION.md` - Step-by-step execution guide
- Scripts created for automated migration

### ✅ Automated Scripts
1. **Schema extraction** - Pulls from MySQL, generates Prisma schema
2. **Table creation** - Creates PostgreSQL tables from schema
3. **Data migration** - Migrates all data from MySQL → PostgreSQL
4. **Data verification** - Compares row counts, ensures integrity
5. **Connection test** - Verifies both databases are reachable

---

## Quick Start (Phase 1)

### 1️⃣ Test Connections (verify setup)
```bash
cd backend-node
npm install
npm run build
npm run phase1:test
```

### 2️⃣ Execute Phase 1 (automated migration)

**Step 1: Extract Schema from MySQL**
```bash
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"
npm run phase1:schema
```

**Step 2: Create Tables in PostgreSQL**
```bash
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
npm run phase1:tables
```

**Step 3: Migrate Data**
```bash
npm run phase1:data
```

**Step 4: Verify Data**
```bash
npm run phase1:verify
```

✅ If last command shows "All tables verified successfully!" - **Phase 1 is done!**

---

## Expected Phase 1 Timeline

| Task | Duration |
|------|----------|
| npm install | 5 min |
| npm run build | 1 min |
| npm run phase1:test | 1 min |
| Schema extract | 2 min |
| Create PostgreSQL tables | 2 min |
| Data migration (186 tables) | 10-15 min |
| Data verification | 2 min |
| **Total** | **~25-30 min** |

---

## What Phase 1 Accomplishes

After Phase 1 complete:
- ✅ PostgreSQL database fully populated with data from MySQL
- ✅ All 186 tables migrated with exact row counts
- ✅ Foreign keys and relationships intact
- ✅ Ready for Phase 2 (Architecture & Permissions)

---

## After Phase 1 - Next Steps

Once Phase 1 completes successfully:

### Phase 2: Core Architecture (2 days)
- Setup permission system
- Setup role system
- Create middleware for auth & validation
- Create response formatter

### Phase 3: Authentication (2 days)
- Login/logout endpoints
- JWT token generation
- Session validation
- Permission checks

### Phase 4: API Endpoints (3-4 weeks)
- User management
- Reservations
- Room management
- Pricing/rates
- OTA integration
- POS & accounting

### Phase 5: Testing (1 week)
- Frontend integration
- QA testing
- Bug fixes

---

## Key Documentation

1. **Full Roadmap**: `/backend-node/MIGRATION_PLAN.md`
2. **Phase 1 Guide**: `/backend-node/PHASE1_EXECUTION.md`
3. **Database Info**: 
   - MySQL: `localhost:3306/draft_rndhms` (Laragon)
   - PostgreSQL: `localhost:5432/hms_anyaman` (Laragon)

---

## Architecture (Current)

```
backend-node/
├── src/
│   ├── index.ts              (Express app - basic setup)
│   ├── scripts/
│   │   ├── migrate-data.ts   (Data migration)
│   │   ├── verify-data.ts    (Data verification)
│   │   └── test-connections.ts (Connectivity test)
│   ├── config/               (Empty - Phase 2)
│   ├── middleware/           (Empty - Phase 2)
│   ├── services/             (Empty - Phase 2)
│   ├── controllers/          (Empty - Phase 2)
│   └── routes/               (Empty - Phase 2)
├── prisma/
│   ├── schema.prisma         (Models - will be regenerated)
│   └── migrations/           (Empty - will be populated)
├── .env                      (Laragon PostgreSQL)
├── package.json              (Updated with scripts)
└── PHASE1_EXECUTION.md       (Step-by-step guide)
```

---

## Troubleshooting

### Issue: "Cannot connect to MySQL"
```
Check if Laragon MySQL is running:
- Open Laragon
- Start MySQL service
- Verify: mysql -u root -h localhost
```

### Issue: "Cannot connect to PostgreSQL"
```
Check if Laragon PostgreSQL is running:
- Open Laragon
- Start PostgreSQL service
- Verify: psql -U postgres -h localhost
```

### Issue: "Module not found: mysql2"
```
Run: npm install
Then: npm run build
```

### Issue: Data migration fails mid-way
```
Check PostgreSQL logs for FK constraint errors
May need to truncate tables and retry
See PHASE1_EXECUTION.md for rollback steps
```

---

## Success Indicator

You'll know Phase 1 is done when:

```bash
$ npm run phase1:verify

Verifying data migration integrity...

✓ accountings                    MySQL:  32360 → PostgreSQL:  32360
✓ allocation_accountings         MySQL:      0 → PostgreSQL:      0
✓ allotments                      MySQL:    xxx → PostgreSQL:    xxx
... (all tables match) ...

======================================================================
✓ All tables verified successfully!
```

---

## Important Notes

- 🔴 **Do NOT start Phase 2 until Phase 1 verification passes**
- 🟡 **MySQL database remains unchanged** - safe to rollback
- 🟢 **PostgreSQL = new source of truth** - once Phase 1 complete
- 📝 **Keep these docs handy** - referenced throughout migration

---

## Quick Reference Commands

```bash
# Test connections
npm run phase1:test

# Full Phase 1 execution (in order)
npm run phase1:schema     # Step 1
npm run phase1:tables     # Step 2
npm run phase1:data       # Step 3
npm run phase1:verify     # Step 4 (success check)

# If you need to start over
rm -rf prisma/migrations  # Clear migrations
npm run build             # Recompile
npm run phase1:test       # Verify connections
npm run phase1:schema     # Start again
```

---

**Ready to begin Phase 1?** → Start with `npm run phase1:test`
