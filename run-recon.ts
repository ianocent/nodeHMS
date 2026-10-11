import * as dotenv from 'dotenv';
dotenv.config();
import { processReconcileBookingEnginePayments } from './src/queue/jobs/reconcileBookingEnginePayments';
processReconcileBookingEnginePayments({}).then(console.log).catch(console.error).finally(() => process.exit());
