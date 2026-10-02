const fs = require('fs');

const sysPath = 'C:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/system.controller.ts';
let c1 = fs.readFileSync(sysPath, 'utf8');
if (!c1.includes("import { Pool }")) {
    c1 = "import { Pool } from 'pg';\n" + c1;
    fs.writeFileSync(sysPath, c1, 'utf8');
}

const pgPath = 'C:/Users/uzuma/Documents/hms-anyaman/backend-node/src/routes/pg-admin.routes.ts';
let c2 = fs.readFileSync(pgPath, 'utf8');
if (!c2.includes("import { Pool }")) {
    c2 = "import { Pool } from 'pg';\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\n" + c2;
    fs.writeFileSync(pgPath, c2, 'utf8');
}
console.log('Fixed');
