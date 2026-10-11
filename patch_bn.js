const fs = require('fs');
let c = fs.readFileSync('src/controllers/reservation.controller.ts', 'utf8');
c = c.replace(/function reservationBn\(val: any\): any \{\r?\n  if \(typeof val === 'bigint'\)/, "function reservationBn(val: any): any {\n  if (val instanceof Date) return val.toISOString();\n  if (typeof val === 'bigint')");
fs.writeFileSync('src/controllers/reservation.controller.ts', c);
