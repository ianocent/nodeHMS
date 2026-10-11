const fs = require('fs');
let code = fs.readFileSync('src/controllers/company.controller.ts', 'utf8');

// Fix contactStore
code = code.replace(
  'const { company_profile_id = req.query.company_id as string, name, position, email, tel, mobile_phone, is_default } = req.body;',
  'const { company_profile_id = req.query.company_id as string, name, position, email, tel, mobile_phone, is_default, status } = req.body; const st = status === undefined ? 1 : (status === true || status === 1 || status === "1" ? 1 : 0);'
);
code = code.replace(
  'is_default: is_default ?? false, created_at:',
  'is_default: is_default ?? false, status: st, created_at:'
);

// Fix contactUpdate
code = code.replace(
  'const { name, position, email, tel, mobile_phone, is_default } = req.body; const data: any = { updated_at: new Date() };',
  'const { name, position, email, tel, mobile_phone, is_default, status } = req.body; const data: any = { updated_at: new Date() }; if (status !== undefined) data.status = (status === true || status === 1 || status === "1" ? 1 : 0);'
);

// Fix store
code = code.replace(
  'billing_address, billing_city, billing_country,',
  'billing_address: v("billing_address"), billing_city: v("billing_city"), billing_country: v("billing_country"),'
);

// Fix update
code = code.replace(
  'if (mobile_phone !== undefined) data.mobile_phone = mobile_phone; if (billing_address !== undefined) data.billing_address = billing_address;',
  'if (mobile_phone !== undefined) data.mobile_phone = mobile_phone; if (v("billing_address") !== undefined) data.billing_address = v("billing_address");'
);
code = code.replace(
  'if (billing_city !== undefined) data.billing_city = billing_city; if (billing_country !== undefined) data.billing_country = billing_country;',
  'if (v("billing_city") !== undefined) data.billing_city = v("billing_city"); if (v("billing_country") !== undefined) data.billing_country = v("billing_country");'
);

fs.writeFileSync('src/controllers/company.controller.ts', code);
