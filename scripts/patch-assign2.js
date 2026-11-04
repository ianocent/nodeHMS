const fs=require('fs');
const p='src/controllers/reservation.controller.ts';
let s=fs.readFileSync(p,'utf8');
const re=/const folio = await prisma\.folios\.findUnique\(\{ where: \{ id: reservation\.folio_id \} \}\);\r?\n(\s+)if \(!folio \|\| folio\.deleted_at\) \{\r?\n(\s+)notFound\(res, 'Folio Not Found'\);\r?\n(\s+)return;\r?\n(\s+)\}/;
const m=s.match(re);
console.log('matches', m? (s.match(new RegExp(re.source,'g'))||[]).length : 0);
s=s.replace(re, function(m, a,b,c,d){ return m + "\n" + a + "if (!(await assertFolioFresh(req, res, reservation.folio_id))) return;"; });
fs.writeFileSync(p,s);
console.log('done');
