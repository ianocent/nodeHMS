const fs = require('fs');
let code = fs.readFileSync('src/controllers/rate.controller.ts', 'utf8');

const target = `          for (const field of GRID_FIELDS) {
            if (preserved[field] === undefined) {
              const val = existing?.[field];
              preserved[field] = val !== undefined && val !== null ? Number(val) : 0;
            }
          }`;

const replacement = `          for (const field of GRID_FIELDS) {
            if (preserved[field] === undefined) {
              const val = existing?.[field];
              preserved[field] = val !== undefined && val !== null ? Number(val) : 0;
            } else {
              if (field.startsWith('stop_')) {
                preserved[field] = preserved[field] === true || preserved[field] === 'true' || preserved[field] === 1 || preserved[field] === '1' ? 1 : 0;
              } else {
                preserved[field] = Number(preserved[field] || 0);
              }
            }
          }`;

code = code.replace(target, replacement);

fs.writeFileSync('src/controllers/rate.controller.ts', code);
