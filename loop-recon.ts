import * as dotenv from 'dotenv';
dotenv.config();
import { processReconcileBookingEnginePayments } from './src/queue/jobs/reconcileBookingEnginePayments';

async function run() {
  let hasMore = true;
  let iterations = 0;
  while (hasMore && iterations < 50) {
    iterations++;
    console.log(`\n--- Iteration ${iterations} ---`);
    const result = await processReconcileBookingEnginePayments({});
    console.log(`Result: ${result}`);
    if (result === 'nothing to reconcile' || result === 'error') {
      hasMore = false;
    }
  }
}

run().then(() => console.log('Done')).catch(console.error).finally(() => process.exit());
