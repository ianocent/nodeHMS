const fs = require('fs');

const sysPath = 'C:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/system.controller.ts';
let c1 = fs.readFileSync(sysPath, 'utf8');
if (!c1.includes("import { PrismaClient }")) {
    c1 = "import { PrismaClient } from '@prisma/client';\n" + c1;
    fs.writeFileSync(sysPath, c1, 'utf8');
    console.log("Fixed PrismaClient in system.controller.ts");
}
