const fs=require('fs');
const p='src/controllers/front-desk.controller.ts';
let s=fs.readFileSync(p,'utf8');
const bad="      const id = idParamBig(req.params.id);\r\n (!(await assertFolioFresh(req, res, id))) return;\r\n whitelist = ['remark'";
const good="      const id = idParamBig(req.params.id);\r\n      if (!(await assertFolioFresh(req, res, id))) return;\r\n      const whitelist = ['remark'";
if(!s.includes(bad)){ console.log('NF'); process.exit(1);}
s=s.replace(bad,good);
fs.writeFileSync(p,s);
console.log('done');
