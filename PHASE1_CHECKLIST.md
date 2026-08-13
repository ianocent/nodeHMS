# Phase 1 Checklist & Setup Summary
## HMS Anyaman Backend Migration

---

## ✅ What's Been Set Up

### Documentation (3 files created)
- ✅ `/backend-node/MIGRATION_PLAN.md` - Full 5-phase roadmap with all details
- ✅ `/backend-node/PHASE1_EXECUTION.md` - Step-by-step Phase 1 guide (6 steps)
- ✅ `/backend-node/PHASE1_README.md` - Quick start + troubleshooting

### Configuration
- ✅ `.env` updated to use Laragon PostgreSQL (no Docker)
- ✅ `package.json` updated with Phase 1 npm scripts
- ✅ `package.json` dependencies: mysql2, pg, @prisma/client added

### Automation Scripts (3 scripts created)
- ✅ `/src/scripts/test-connections.ts` - Verify MySQL & PostgreSQL connectivity
- ✅ `/src/scripts/migrate-data.ts` - Migrate all data from MySQL → PostgreSQL
- ✅ `/src/scripts/verify-data.ts` - Compare row counts, verify integrity

### Project Structure
```
backend-node/
├── src/scripts/
│   ├── test-connections.ts    ✅ NEW
│   ├── migrate-data.ts        ✅ NEW
│   └── verify-data.ts         ✅ NEW
├── .env                       ✅ UPDATED
├── package.json               ✅ UPDATED
├── MIGRATION_PLAN.md          ✅ NEW
├── PHASE1_EXECUTION.md        ✅ NEW
└── PHASE1_README.md           ✅ NEW
```

---

## 🎯 Current Status: Ready to Execute Phase 1

### Database Status
- ✅ MySQL (Laragon): `draft_rndhms` running, 186 tables with data
- ✅ PostgreSQL (Laragon): `hms_anyaman` created, empty, ready for migration

### Code Status
- ✅ Express app initialized
- ✅ Prisma configured
- ✅ TypeScript configured
- ✅ All Phase 1 scripts ready to compile

---

## 🚀 Next: Execute Phase 1 (4 Steps)

### Prerequisites Check
Before running commands, ensure:
- [ ] Laragon is running
- [ ] MySQL service started in Laragon
- [ ] PostgreSQL service started in Laragon
- [ ] Terminal open in `backend-node` folder

### Phase 1 Execution

**Step 1: Install Dependencies & Verify Setup**
```bash
cd backend-node
npm install
npm run build
npm run phase1:test
```
Expected: "✓ All database connections successful!"

---

**Step 2: Extract Schema from MySQL**
```bash
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"
npm run phase1:schema
```
Expected: "Introspected 186 models from MySQL database"

---

**Step 3: Create PostgreSQL Tables**
```bash
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
npm run phase1:tables
```
Expected: "Migration applied successfully"

---

**Step 4: Migrate Data & Verify**
```bash
npm run phase1:data
npm run phase1:verify
```
Expected: "✓ All tables verified successfully!"

---

## 📊 Phase 1 Key Numbers

| Item | Count |
|------|-------|
| Tables to migrate | 186 |
| MySQL data rows | ~574MB total |
| Estimated migration time | 10-15 min |
| Total Phase 1 time (with setup) | ~25-30 min |

---

## 🔍 Verification Checklist

After running all 4 steps, verify:

- [ ] `npm run phase1:test` shows both databases connected
- [ ] Schema extraction shows "Introspected 186 models"
- [ ] PostgreSQL table creation succeeds
- [ ] Data migration completes with row counts
- [ ] Data verification shows "All tables verified successfully!"

If all ✅, **Phase 1 is complete!**

---

## 📝 Important Notes

### Before Starting Phase 1

1. **Backup**: Laragon MySQL `draft_rndhms` database has a backup in `draft_rndhms.sql`
2. **Fresh Start**: If you need to restart, run this:
   ```bash
   psql -U postgres -h localhost -d hms_anyaman -c "DROP SCHEMA public CASCADE;"
   psql -U postgres -h localhost -d hms_anyaman -c "CREATE SCHEMA public;"
   rm -rf prisma/migrations
   npm run build
   ```

### Environment Variables

During Phase 1, you'll switch the `DATABASE_URL` twice:

```bash
# During schema extraction (Step 2)
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"

# During table creation & data migration (Steps 3-4)
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
```

The `.env` file will have the PostgreSQL version as default.

---

## 🎓 Learning Resources

If you want to understand what each script does:

- `test-connections.ts`: Connects to both DBs, verifies accessibility
- `migrate-data.ts`: Reads MySQL tables, inserts into PostgreSQL
- `verify-data.ts`: Compares row counts to ensure nothing was lost

All are in `/src/scripts/` and can be run independently.

---

## ⏭️ After Phase 1 Complete

Once Phase 1 verification passes:

1. PostgreSQL will have 186 tables with all data
2. You can start Phase 2 (Core Architecture)
3. MySQL database can be archived (no longer needed for migration)
4. Frontend can stay unchanged until Phase 3

---

## 🆘 Troubleshooting Quick Links

| Problem | Solution |
|---------|----------|
| "Cannot connect to MySQL" | Start MySQL in Laragon |
| "Cannot connect to PostgreSQL" | Start PostgreSQL in Laragon |
| "Module not found: mysql2" | Run `npm install` |
| "Command not found: npm" | Install Node.js or add to PATH |
| "Data migration fails" | Check PostgreSQL error logs, see rollback steps |

---

## 📖 Full Documentation

For complete details, see:
- `MIGRATION_PLAN.md` - All 5 phases with complete roadmap
- `PHASE1_EXECUTION.md` - Detailed troubleshooting for each step
- `PHASE1_README.md` - Architecture and reference commands

---

**Status**: Phase 1 setup complete, ready to execute

**Time to complete Phase 1**: ~25-30 minutes

**Next action**: Run `npm run phase1:test` to verify database connectivity
