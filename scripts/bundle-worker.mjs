import fs from 'node:fs';
import path from 'node:path';

const distServer = path.resolve('dist/server');
const distClient = path.resolve('dist/client');

if (fs.existsSync(distServer) && fs.existsSync(distClient)) {
  const workerDir = path.join(distClient, '_worker.js');
  if (!fs.existsSync(workerDir)) {
    fs.mkdirSync(workerDir, { recursive: true });
  }

  // Copy entry.mjs as index.js inside _worker.js directory (and its source map if present)
  fs.copyFileSync(path.join(distServer, 'entry.mjs'), path.join(workerDir, 'index.js'));
  if (fs.existsSync(path.join(distServer, 'entry.mjs.map'))) {
    fs.copyFileSync(path.join(distServer, 'entry.mjs.map'), path.join(workerDir, 'entry.mjs.map'));
  }

  // Copy virtual_astro_middleware.mjs and its source map if present
  const vmid = path.join(distServer, 'virtual_astro_middleware.mjs');
  if (fs.existsSync(vmid)) {
    fs.copyFileSync(vmid, path.join(workerDir, 'virtual_astro_middleware.mjs'));
  }
  const vmidMap = path.join(distServer, 'virtual_astro_middleware.mjs.map');
  if (fs.existsSync(vmidMap)) {
    fs.copyFileSync(vmidMap, path.join(workerDir, 'virtual_astro_middleware.mjs.map'));
  }

  // Recursively copy chunks directory into _worker.js/chunks
  const srcChunks = path.join(distServer, 'chunks');
  const destChunks = path.join(workerDir, 'chunks');
  if (fs.existsSync(srcChunks)) {
    fs.cpSync(srcChunks, destChunks, { recursive: true });
  }

  console.log('✓ Successfully bundled Cloudflare Pages _worker.js into dist/client/');
}
