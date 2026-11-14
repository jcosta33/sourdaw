import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
if (process.argv.length !== 3) throw new Error('Usage: exports.fixture.mjs <capsule-web-package>');
const web = resolve(process.argv[2]);
const requireWeb = createRequire(join(web, 'package.json'));
const names = [
    'ort.all.js',
    'ort.all.min.js',
    'ort.all.mjs',
    'ort.all.min.mjs',
    'ort.all.bundle.min.mjs',
    'ort.webgl.js',
    'ort.webgl.min.js',
    'ort.webgl.mjs',
    'ort.webgl.min.mjs',
];
for (const name of names) {
    const file = join(web, 'dist', name);
    const ort = name.endsWith('.mjs') ? await import(pathToFileURL(file)) : requireWeb(file);
    assert.equal(typeof ort.InferenceSession.create, 'function', name);
    assert.equal(typeof ort.Tensor, 'function', name);
    assert.equal(typeof ort.env, 'object', name);
    assert.equal(ort.env.versions.web, '1.31.1', name);
}
console.log('All nine actual entry files expose the ORT API in Node; browser/worker remain distinct obligations.');
