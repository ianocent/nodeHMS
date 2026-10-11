// @ts-nocheck
import { prisma } from './src/config/prisma';

async function run() {
  console.log('Finding duplicates...');
  
  const duplicates = await prisma.guest_profiles.groupBy({
    by: ['account'],
    having: {
      account: {
        _count: {
          gt: 1,
        },
      },
    },
    where: {
      account: {
        not: ''
      }
    }
  });
  
  console.log('Duplicates:', duplicates.length > 0 ? duplicates : 'None');
  
  for (const dup of duplicates) {
    if (!dup.account) continue;
    const records = await prisma.guest_profiles.findMany({
      where: { account: dup.account },
      orderBy: { id: 'asc' }
    });
    
    console.log('Cleaning up account:', dup.account);
    // Keep the first one, append -dup-ID to the rest
    for (let i = 1; i < records.length; i++) {
      const rec = records[i];
      await prisma.guest_profiles.update({
        where: { id: rec.id },
        data: { account: `${rec.account}-dup-${rec.id}` }
      });
      console.log('Updated ID', rec.id, 'to', `${rec.account}-dup-${rec.id}`);
    }
  }
  
  console.log('Done cleaning duplicates. Adding unique constraint...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "guest_profiles" ADD CONSTRAINT "guest_profiles_account_unique" UNIQUE ("account")`);
    console.log('Unique constraint added successfully.');
  } catch (err: any) {
    console.log('Failed to add constraint:', err.message);
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
