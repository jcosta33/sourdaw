import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoot, requireGraph } from './installed.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(process.argv[2] ?? join(directory, '../..'));
const manifest = JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8'));
const installed = requireGraph(repository);
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function inventory(directory) {
    const files = {};
    function walk(path) {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            if (entry.name === 'node_modules') continue;
            const file = join(path, entry.name);
            if (entry.isDirectory()) walk(file);
            else {
                assert.equal(entry.isFile(), true, `Unexpected package link: ${file}`);
                files[relative(directory, file).split(sep).join('/')] = digest(file);
            }
        }
    }
    walk(directory);
    return files;
}
let files = 0;
for (const record of manifest.packages) {
    const root = installed.root(record.name);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, record.version);
    assert.deepEqual(inventory(root), record.files, `Installed bytes changed: ${record.name}`);
    if (record.patch) assert.equal(digest(join(repository, record.patch)), record.patchSha256, record.patch);
    files += Object.keys(record.files).length;
}
const edges = [
    ...manifest.edges,
    { parent: 'onnxruntime-web', child: 'protobufjs', expected: '8.8.1' },
    { parent: '@tensorflow/tfjs-core', child: 'long', expected: '5.3.2' },
    { parent: '@tensorflow/tfjs', child: 'long', expected: '5.3.2' },
    { parent: '@tensorflow/tfjs-core', child: '@webgpu/types', expected: '0.1.74' },
];
for (const edge of edges) {
    const parent = installed.root(edge.parent);
    const requireParent = createRequire(join(parent, 'package.json'));
    const child = packageRoot(edge.child, requireParent);
    assert.equal(JSON.parse(readFileSync(join(child, 'package.json'), 'utf8')).version, edge.expected);
    assert.equal(
        realpathSync(join(edge.parent.startsWith('@') ? dirname(dirname(parent)) : dirname(parent), edge.child)),
        child,
        `Missing physical parent edge: ${edge.parent}>${edge.child}`
    );
}
console.log(JSON.stringify({ packages: manifest.packages.length, files, physicalEdges: edges.length }));
