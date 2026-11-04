const fs=require('fs');
const p='src/controllers/reservation.controller.ts';
let s=fs.readFileSync(p,'utf8');
const idx=s.indexOf("Folio Not Found");
// find the third occurrence
let i=-1, count=0;
while(true){ i=s.indexOf("Folio Not Found", i+1); if(i<0) break; count++; if(count===3){ console.log(JSON.stringify(s.slice(i-200,i+80))); break;} }
