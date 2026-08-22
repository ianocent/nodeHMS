// Laravel Jobs/SyncStaahRoomType.php parity — push room type content create/modify
// to the channel manager, then stamp the mapping with last_sync_at + response data.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaahService } from '../../services/staah.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function processSyncStaahRoomType(job: any) {
  const data = job.data || {};
  const payload = data.data;
  const mappingId = data.staahRoomMappingId;

  if (!payload || !mappingId) {
    console.warn('[SyncStaahRoomType] missing data or staahRoomMappingId');
    return 'skipped';
  }

  const mapping = await prisma.staah_room_mappings.findUnique({ where: { id: BigInt(mappingId) } });
  if (!mapping) {
    console.warn(`[SyncStaahRoomType] mapping ${mappingId} not found`);
    return 'not found';
  }

  const staahService = new StaahService();
  let response: any;
  try {
    response = await staahService.createUpdateDeleteRoomType(payload);
  } catch (err: any) {
    console.error(`[SyncStaahRoomType] failed for mapping ${mappingId}:`, err?.message);
    return 'failed';
  }

  await prisma.staah_room_mappings.update({
    where: { id: BigInt(mappingId) },
    data: {
      last_sync_at: new Date(),
      ...(response !== undefined ? { data: response as any } : {}),
      updated_at: new Date(),
    },
  });

  return 'success';
}
