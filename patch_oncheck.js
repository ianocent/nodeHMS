const fs = require('fs');
const file = 'src/controllers/reservation.controller.ts';
let c = fs.readFileSync(file, 'utf8');

const target = "      success(res, { check: allAvailable, roomIds }, 'Success');";
const replacement = `      const fakeReservationList: any[] = [];
      for (const item of roomList) {
        const qty = item.qty || 1;
        for (let i = 0; i < qty; i++) {
          fakeReservationList.push({ ...item, check_in_date, check_out_date, rate_id });
        }
      }
      const fakeReq = { ...req, body: { ...req.body, reservation_list: fakeReservationList } } as any;
      const fakeRes = {
        json: (payload: any) => {
          success(res, { check: allAvailable, roomIds, date: payload?.data?.date, charge: payload?.data?.charge }, 'Success');
        },
        status: (s: number) => fakeRes,
      } as any;
      await ReservationController.getCharge(fakeReq, fakeRes);`;

c = c.replace(target, replacement);
fs.writeFileSync(file, c);
