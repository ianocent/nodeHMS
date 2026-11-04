const fs=require('fs');
const p='src/controllers/front-desk.controller.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(" (!(await assertFolioFresh(req, res, id))) return;\r\n whitelist = [", "      if (!(await assertFolioFresh(req, res, id))) return;\r\n      const whitelist = [");
fs.writeFileSync(p,s);
console.log('done');
// verify
const lines=fs.readFileSync(p,'utf8').split(/\r?\n/);
console.log(lines[2636], lines[2637]);
