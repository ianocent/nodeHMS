import 'dotenv/config';
import { getFolioVersion, getRoomVersion } from '../src/utils/concurrency';(async () => {
  console.log('folio 7:', await getFolioVersion(BigInt(7)));  console.log('room 1:', await getRoomVersion(BigInt(1)));
  process.exit(0);
})();
