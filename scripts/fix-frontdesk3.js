const fs=require('fs');
const p='src/controllers/front-desk.controller.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace("      const id = idParamBig(req.params.id);\n (!(await assertFolioFresh(req, res, id))) return;\n whitelist = ['remark'", "      const id = idParamBig(req.params.id);\n      if (!(await assertFolioFresh(req, res, id))) return;\n      const whitelist = ['remark'");
fs.writeFileSync(p,s);
console.log('done');
