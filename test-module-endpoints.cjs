const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=([^\r\n]*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const axios = require('axios');
const h = {
  Authorization: 'Basic ' + process.env.STAAH_CLIENT_SECRET,
  'app-id': process.env.STAAH_CLIENT_ID,
  'Content-Type': 'application/json'
};
(async () => {
  console.log('=== NODE BACKEND API CONTRACT TEST ===\n');
  const tests = [
    { name: 'STAAH testConnection', method: 'get', url: '/SUAPI/jservice/pmsproperty' },
    { name: 'STAAH roomdetails', method: 'post', url: '/SUAPI/jservice/roomdetails', body: { hotelid: '999' } },
    { name: 'STAAH ratedetails', method: 'post', url: '/SUAPI/jservice/ratedetails', body: { hotelid: '999' } },
    { name: 'STAAH availability', method: 'post', url: '/SUAPI/jservice/availability', body: { hotelid: '999', room: [] } }
  ];
  for (const t of tests) {
    const t0 = Date.now();
    try {
      let r;
      if (t.method === 'get') {
        r = await axios.get(process.env.STAAH_BASE_URL + t.url, { headers: h, timeout: 10000 });
      } else {
        r = await axios.post(process.env.STAAH_BASE_URL + t.url, t.body, { headers: h, timeout: 10000 });
      }
      const t1 = Date.now();
      const status = r.data.Status || r.data.status || r.status;
      console.log(`✓ ${t.name}: ${t1-t0}ms | Status=${status}`);
    } catch (e) {
      console.log(`✗ ${t.name}: ${e.message?.split('\n')[0] || e.code}`);
    }
  }
  console.log('\n=== TESTS COMPLETE ===');
})();