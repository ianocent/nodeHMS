const fs = require('fs');

const sysPath = 'C:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/system.controller.ts';
let c1 = fs.readFileSync(sysPath, 'utf8');
if (!c1.includes("import { PrismaPg }")) {
    c1 = "import { PrismaPg } from '@prisma/adapter-pg';\n" + c1;
    fs.writeFileSync(sysPath, c1, 'utf8');
    console.log("Fixed PrismaPg in system.controller.ts");
}
