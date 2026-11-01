import fs from 'node:fs';
import path from 'node:path';

const distServer = path.resolve('dist/server');
const distClient = path.resolve('dist/client');

if (fs.existsSync(distServer) && fs.existsSync(distClient)) {
  const workerDir = path.join(distClient, '_worker.js');
  if (!fs.existsSync(workerDir)) {
    fs.mkdirSync(workerDir, { recursive: true });
  }

  // Helper to copy JS files while stripping dangling sourceMappingURL comments
  const copyWithoutSourceMap = (srcPath, destPath) => {
    let code = fs.readFileSync(srcPath, 'utf8');
    code = code.replace(/\/\/# sourceMappingURL=.*$/gm, '');
    fs.writeFileSync(destPath, code, 'utf8');
  };

  // Copy entry.mjs as index.js inside _worker.js directory
  copyWithoutSourceMap(path.join(distServer, 'entry.mjs'), path.join(workerDir, 'index.js'));

  // Copy virtual_astro_middleware.mjs if present
  const vmid = path.join(distServer, 'virtual_astro_middleware.mjs');
  if (fs.existsSync(vmid)) {
    copyWithoutSourceMap(vmid, path.join(workerDir, 'virtual_astro_middleware.mjs'));
  }

  // Recursively copy chunks directory into _worker.js/chunks while excluding .map files and stripping map comments
  const srcChunks = path.join(distServer, 'chunks');
  const destChunks = path.join(workerDir, 'chunks');
  if (fs.existsSync(srcChunks)) {
    if (!fs.existsSync(destChunks)) {
      fs.mkdirSync(destChunks, { recursive: true });
    }
    for (const file of fs.readdirSync(srcChunks)) {
      if (!file.endsWith('.map')) {
        copyWithoutSourceMap(path.join(srcChunks, file), path.join(destChunks, file));
      }
    }
  }

  console.log('✓ Successfully bundled Cloudflare Pages _worker.js into dist/client/ (source maps excluded and stripped)');
}
