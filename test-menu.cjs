const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=([^\r\n]*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const axios = require('axios');
const h = { Authorization: 'Basic ' + process.env.STAAH_CLIENT_SECRET, 'app-id': process.env.STAAH_CLIENT_ID };
(async () => {
  try {
    const r = await axios.get('http://127.0.0.1:3001/cms/menu?page=1&limit=100&name=&trash=0', { headers: h, timeout: 10000 });
    console.log('Status:', r.status);
    console.log('Data:', JSON.stringify(r.data).slice(0, 500));
  } catch (e) {
    console.log('ERR:', e.message ? e.message : e.response ? e.response.status + ' ' + JSON.stringify(e.response.data).slice(0, 200) : e.code);
  }
})();