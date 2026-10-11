const fs = require('fs');
let code = fs.readFileSync('src/controllers/company.controller.ts', 'utf8');

code = code.replace(
  'const { name, email, telp, mobile_phone, billing_address: v("billing_address"), billing_city: v("billing_city"), billing_country: v("billing_country"), credit_limit, status } = req.body;',
  'const { name, email, telp, mobile_phone, credit_limit, status } = req.body;'
);

fs.writeFileSync('src/controllers/company.controller.ts', code);
