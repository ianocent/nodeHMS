import { prisma } from '../../config/prisma';
import { runCalculation, runApply } from '../../controllers/dynamic-rate.controller';

export async function processSyncDynamicRates(job: any): Promise<void> {
  const configs = await prisma.dynamic_rate_configs.findMany({
    where: {
      auto_apply: 1,
      status: 1
    }
  });

  if (configs.length === 0) {
    console.log('[dynamic-rate-sync] No active auto-apply configs found.');
    return;
  }

  for (const config of configs) {
    console.log(`[dynamic-rate-sync] Processing config: ${config.name} (ID: ${config.id})`);
    try {
      const resultsCount = await runCalculation(config, undefined, null);
      console.log(`[dynamic-rate-sync] Calculated: ${resultsCount} forecasts`);
      
      const applyResult = await runApply(config, {}, null);
      console.log(`[dynamic-rate-sync] Applied: ${applyResult.applied} rates to BAR`);
    } catch (err: any) {
      console.error(`[dynamic-rate-sync] Failed config ID ${config.id}:`, err?.message || err);
    }
  }

  console.log('[dynamic-rate-sync] Sync complete.');
}
