import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const info = {
  styleSpecCommit: git('rev-parse', 'HEAD'),
  styleSpecVersion: JSON.parse(await readFile('package.json')).version,
  rendererBaseCommit: process.argv[2],
  rendererPatchSha256: await sha256('demos/latitude/renderer.patch'),
  brightStyleSha256: await sha256('demos/latitude/bright.json'),
  brightStyleSource: 'https://tiles.openfreemap.org/styles/bright',
  rendererBundleSha256: await sha256('demos/latitude/assets/maplibre-gl.mjs'),
  builtAt: new Date().toISOString(),
  node: process.version,
  experimental: true
};
await writeFile('demos/latitude/build-info.json', JSON.stringify(info,null,2)+'\n');
