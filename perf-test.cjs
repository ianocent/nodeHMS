const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=([^\r\n]*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const axios = require('axios');
const h = { Authorization: 'Basic ' + process.env.STAAH_CLIENT_SECRET, 'app-id': process.env.STAAH_CLIENT_ID };
(async () => {
  // Test STAAH testConnection
  const t0 = Date.now();
  const r = await axios.get(process.env.STAAH_BASE_URL + '/SUAPI/jservice/pmsproperty', { headers: h, timeout: 10000 });
  const t1 = Date.now();
  console.log('Node STAAH testConnection:', t1 - t0, 'ms, status:', r.status);

  // Test roomdetails
  const t2 = Date.now();
  const r2 = await axios.post(process.env.STAAH_BASE_URL + '/SUAPI/jservice/roomdetails', { hotelid: '999' }, { headers: h, timeout: 10000 });
  const t3 = Date.now();
  console.log('Node STAAH roomdetails:', t3 - t2, 'ms, rooms:', r2.data.rooms.length);

  // Test ratedetails
  const t4 = Date.now();
  const r3 = await axios.post(process.env.STAAH_BASE_URL + '/SUAPI/jservice/ratedetails', { hotelid: '999' }, { headers: h, timeout: 10000 });
  const t5 = Date.now();
  console.log('Node STAAH ratedetails:', t5 - t4, 'ms, plans:', r3.data.rateplans.length);

  // Test availability
  const today = new Date();
  const d1 = today.toISOString().slice(0, 10);
  const d2 = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const p = { hotelid: '999', room: [{ roomid: 'MJS', date: [{ from: d1, to: d2, rate: [{ rateplanid: 'OTARO' }], price: [{ NumberOfGuests: '1', value: '500000' }], closed: '0', minimumstay: '1', maximumstay: '5', closedonarrival: '0', closedondeparture: '0', extraadultrate: '100000.00', extrachildrate: '50000.00' }] }] };
  const t6 = Date.now();
  const r4 = await axios.post(process.env.STAAH_BASE_URL + '/SUAPI/jservice/availability', p, { headers: h, timeout: 10000 });
  const t7 = Date.now();
  console.log('Node STAAH availability:', t7 - t6, 'ms, status:', r4.data.Status);
})();