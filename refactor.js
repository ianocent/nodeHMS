const fs = require('fs');
const path = require('path');

const dirs = [
  path.join(__dirname, 'src/controllers'),
  path.join(__dirname, 'src/services'),
  path.join(__dirname, 'src/routes'),
  path.join(__dirname, 'src/middleware'),
  path.join(__dirname, 'src/queue/jobs')
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // 1. Remove duplicate imports and pool instantiations
  const patternsToRemove = [
    /import\s*{\s*PrismaClient\s*}\s*from\s*['"]@prisma\/client['"];?\r?\n?/g,
    /import\s*{\s*PrismaPg\s*}\s*from\s*['"]@prisma\/adapter-pg['"];?\r?\n?/g,
    /import\s*{\s*Pool\s*}\s*from\s*['"]pg['"];?\r?\n?/g,
    /const\s*pool\s*=\s*new\s*Pool\([^)]*\);?\r?\n?/g,
    /const\s*adapter\s*=\s*new\s*PrismaPg\(pool\);?\r?\n?/g,
    /const\s*prisma\s*=\s*new\s*PrismaClient\([^)]*\);?\r?\n?/g,
    // Handle variations like combined imports
    /import\s*{\s*PrismaClient\s*,\s*Prisma\s*}\s*from\s*['"]@prisma\/client['"];?\r?\n?/g,
  ];

  patternsToRemove.forEach(regex => {
    if (regex.test(content)) {
      content = content.replace(regex, '');
      changed = true;
    }
  });

  if (changed) {
    // 2. Determine relative path to src/config/prisma
    const srcDir = path.join(__dirname, 'src');
    const fileDir = path.dirname(filePath);
    let relativePath = path.relative(fileDir, path.join(srcDir, 'config', 'prisma'));
    // Convert backslashes to forward slashes for imports
    relativePath = relativePath.replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
    }

    // Insert new global import at the top
    const importStatement = `import { prisma } from '${relativePath}';\n`;
    
    // Also re-add Prisma if it was stripped from the combined import
    if (content.includes('Prisma.')) {
        content = `import { Prisma } from '@prisma/client';\n` + content;
    }
    
    content = importStatement + content;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Refactored: ${filePath}`);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

dirs.forEach(walkDir);
console.log('Refactor complete. Run "npx tsc --noEmit" to verify types.');
