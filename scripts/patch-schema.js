const fs=require('fs');
const p='prisma/schema.prisma';
let s=fs.readFileSync(p,'utf8');
const models=['folios','reservations','rooms','housekeeper_history','transactions'];
for (const m of models) {
  const re=new RegExp('(model '+m+' \\{[\\s\\S]*?)(\\n\\})', 'm');
  const match=s.match(re);
  if (!match) { console.log('model not found', m); continue; }
  // avoid duplicate
  if (match[1].includes('version BigInt')) { console.log('already', m); continue; }
  s=s.replace(re, '$1\n  version BigInt @default(1)$2');
  console.log('patched', m);
}
fs.writeFileSync(p,s);
console.log('done');
