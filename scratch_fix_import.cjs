const fs = require('fs');

let code = fs.readFileSync('src/pages/api/admin/recipes.ts', 'utf8');

const target = `import { repoRecipePath, writeRepoFile } from '../../../lib/github';`;
const replacement = `import { getRepoFile, repoRecipePath, writeRepoFile } from '../../../lib/github';`;

function replaceNorm(src, t, r) {
  const normSrc = src.replace(/\r\n/g, '\n');
  const normT = t.replace(/\r\n/g, '\n');
  const normR = r.replace(/\r\n/g, '\n');
  if (!normSrc.includes(normT)) {
    console.error('Failed to match target');
    process.exit(1);
  }
  return normSrc.replace(normT, normR);
}

const updated = replaceNorm(code, target, replacement);
fs.writeFileSync('src/pages/api/admin/recipes.ts', updated.replace(/\n/g, '\r\n'), 'utf8');
console.log('Successfully added getRepoFile import to src/pages/api/admin/recipes.ts');

