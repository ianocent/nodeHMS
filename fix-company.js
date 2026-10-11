const fs = require('fs');
const p = 'c:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/company.controller.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/const companyId = req\.query\.company_id as string;/g, 'const companyId = (req.query.company_profile_id || req.query.company_id) as string;');

fs.writeFileSync(p, c);
