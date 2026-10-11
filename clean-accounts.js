const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const duplicates = await prisma.$queryRaw`
    SELECT account, COUNT(*) as count 
    FROM guest_profiles 
    WHERE account IS NOT NULL AND account != ''
    GROUP BY account 
    HAVING count > 1
  `;
  
  console.log('Duplicates:', duplicates.length > 0 ? duplicates : 'None');
  
  for (const dup of duplicates) {
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
    await prisma.$executeRaw`ALTER TABLE guest_profiles ADD UNIQUE (account)`;
    console.log('Unique constraint added successfully.');
  } catch (err) {
    console.log('Failed to add constraint:', err.message);
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
