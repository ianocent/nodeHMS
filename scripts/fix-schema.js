/**
 * fix-schema-v3.js
 * 
 * Final comprehensive fix. Strategy:
 * 1. Strip all `map: "..."` from @relation - PostgreSQL generates its own names
 * 2. Strip all `map: "..."` from @@index where they conflict  
 * 3. Remove trailing (N) and (N, M) annotations
 * 4. Fix broken @@index refs
 * 5. Remove url from datasource
 */

const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../prisma/schema.prisma');

let schema = fs.readFileSync(schemaPath, 'utf8');
console.log('Input schema length:', schema.length, 'bytes');

// ============================================================
// Fix 1: Remove `url` from datasource (Prisma 7)
// ============================================================
schema = schema.replace(/\n\s*url\s*=\s*env\("DATABASE_URL"\)\n/g, '\n');
console.log('✓ Step 1: Removed url from datasource');

// ============================================================
// Fix 2: Remove ALL trailing (N) or (N, M) patterns at end of lines
// ============================================================
schema = schema.replace(/\s+\(\d+(?:,\s*\d+)?\)\s*$/gm, '');
console.log('✓ Step 2: Removed invalid MySQL length annotations');

// ============================================================
// Fix 3: Strip `map: "..."` from ALL @relation attributes
// This eliminates ALL constraint name conflicts since Prisma will auto-generate
// Pattern: @relation(fields: [...], references: [...], onDelete: ..., onUpdate: ..., map: "...")
// ============================================================
schema = schema.replace(/,\s*map:\s*"[^"]+"\)/g, ')');
console.log('✓ Step 3: Stripped map: names from @relation (eliminates constraint conflicts)');

// ============================================================
// Fix 4: Fix @@index lines that reference non-existent fields
// Based on validate errors: tasks model has created_at in index but field doesn't exist
// Also staah_sync_logs has status in index but field was removed
// ============================================================

// Fix tasks model - remove indexes with created_at  
schema = schema.replace(
  /\s+@@index\(\[created_by, status, created_at\(sort: Desc\)\], map: "[^"]+"\)/g, ''
);
schema = schema.replace(
  /\s+@@index\(\[department, status, created_at\], map: "[^"]+"\)/g, ''
);
schema = schema.replace(
  /\s+@@index\(\[to_user_id, status, priority, created_at\(sort: Desc\)\], map: "[^"]+"\)/g, ''
);

// Fix staah_sync_logs - remove @@index([status])
schema = schema.replace(
  /\s+@@index\(\[status\], map: "status"\)/g, ''
);

console.log('✓ Step 4: Fixed broken @@index declarations');

// ============================================================
// Fix 5: Fix duplicate @@index map names within same model
// PostgreSQL doesn't allow duplicate index names across the DB
// Strategy: strip all map: from @@index too (Prisma will auto-name)
// ============================================================
schema = schema.replace(/@@index\((\[[^\]]+\])\s*,\s*map:\s*"[^"]+"\)/g, '@@index($1)');
console.log('✓ Step 5: Stripped map: from @@index (Prisma auto-names indexes)');

// ============================================================
// Fix 6: Fix @@unique map names too
// ============================================================  
schema = schema.replace(/@@unique\((\[[^\]]+\])\s*,\s*map:\s*"[^"]+"\)/g, '@@unique($1)');
console.log('✓ Step 6: Stripped map: from @@unique');

// ============================================================
// Fix 7: Deduplicate @@index within each model block
// Prisma auto-names indexes as <model>_<fields>_idx - if same fields
// appear twice in one model, we get constraint name conflicts
// ============================================================
function deduplicateIndexes(schemaText) {
  // Process each model block separately
  const lines = schemaText.split('\n');
  const result = [];
  let inModel = false;
  let modelIndexes = new Set();
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect model start
    if (trimmed.startsWith('model ') && trimmed.endsWith('{')) {
      inModel = true;
      modelIndexes = new Set();
      result.push(line);
      continue;
    }
    
    // Detect model end
    if (inModel && trimmed === '}') {
      inModel = false;
      modelIndexes = new Set();
      result.push(line);
      continue;
    }
    
    // Check for @@index duplicates within model
    if (inModel && trimmed.startsWith('@@index(')) {
      const key = trimmed;
      if (modelIndexes.has(key)) {
        // Skip duplicate
        continue;
      }
      modelIndexes.add(key);
    }
    
    result.push(line);
  }
  
  return result.join('\n');
}

schema = deduplicateIndexes(schema);
console.log('✓ Step 7: Deduplicated @@index within models');

// ============================================================
// Write fixed schema
// ============================================================
fs.writeFileSync(schemaPath, schema, 'utf8');
console.log('\n✓ Schema v3 fixed successfully!');
console.log('Final schema length:', schema.length, 'bytes');
console.log('\nNext: Run `npx prisma validate` to verify');
