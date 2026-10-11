const fs = require('fs');
const file = 'src/controllers/company.controller.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `      let table = TABLES.companyContact;
      if (companyId) {
        const depts = await prisma.company_profile_departments.findMany({ where: { company_profile_id: BigInt(companyId) }, select: { id: true, department: true } });
        if (depts.length) {
          table = table.map((c: any) => c.key === 'department' ? { ...c, options: depts.map((d: any) => ({ value: Number(d.id), label: d.department })) } : c);
          const deptById = new Map(depts.map((d: any) => [String(d.id), d.department]));
          for (const row of data as any[]) {`;

const replacement = `      let table = TABLES.companyContact;
      if (companyId) {
        const depts = await prisma.company_profile_departments.findMany({ where: { company_profile_id: BigInt(companyId) }, select: { id: true, department: true } });
        table = table.map((c: any) => c.key === 'department' ? { ...c, options: depts.map((d: any) => ({ value: Number(d.id), label: d.department })) } : c);
        if (depts.length) {
          const deptById = new Map(depts.map((d: any) => [String(d.id), d.department]));
          for (const row of data as any[]) {`;

// Handle possible \r\n vs \n
code = code.replace(target.replace(/\n/g, '\r\n'), replacement.replace(/\n/g, '\r\n'));
code = code.replace(target.replace(/\n/g, '\n'), replacement.replace(/\n/g, '\n'));

fs.writeFileSync(file, code);
console.log("Done");
