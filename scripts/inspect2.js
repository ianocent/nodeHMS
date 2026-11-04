const fs=require('fs');
const p='src/controllers/front-desk.controller.ts';
let s=fs.readFileSync(p,'utf8');
const i=s.indexOf("static async updateData");
console.log(JSON.stringify(s.slice(i,i+260)));
