const fs=require('fs');
const p='src/controllers/reservation.controller.ts';
let s=fs.readFileSync(p,'utf8');
const old="      if (!folio || folio.deleted_at) {\n        notFound(res, 'Folio Not Found');\n        return;\n      }\n\n      if (room_id) {";
const ne="      if (!folio || folio.deleted_at) {\n        notFound(res, 'Folio Not Found');\n        return;\n      }\n      if (!(await assertFolioFresh(req, res, reservation.folio_id))) return;\n\n      if (room_id) {";
if(!s.includes(old)){ console.log('NF'); process.exit(1);}
s=s.replace(old,ne);
fs.writeFileSync(p,s);
console.log('done');
