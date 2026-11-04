const fs=require('fs');
const p='src/controllers/reservation.controller.ts';
let s=fs.readFileSync(p,'utf8');
const re=/const folio = await prisma\.folios\.findUnique\(\{ where: \{ id: reservation\.folio_id \} \}\);\r?\n       if \(!folio \|\| folio\.deleted_at\) \{\r?\n         notFound\(res, 'Folio Not Found'\);\r?\n         return;\r?\n       \}/;
const m=s.match(re);
console.log('matches', m?m.length:0);
s=s.replace(re, function(x){ return x + "\n       if (!(await assertFolioFresh(req, res, reservation.folio_id))) return;"; });
fs.writeFileSync(p,s);
console.log('done');
