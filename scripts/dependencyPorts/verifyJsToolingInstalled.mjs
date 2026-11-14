import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { installedGraph, physicalChild } from './jsToolingInstalled.mjs';

const repository = resolve(process.argv[2] ?? join(import.meta.dirname, '../..'));
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'jsToolingProvenance.json'), 'utf8'));
const graph = installedGraph(repository);
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function inventory(root) {
    const files = {};
    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'node_modules') continue;
            const file = join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else {
                assert(entry.isFile(), `Unexpected package symlink: ${file}`);
                files[relative(root, file).split(sep).join('/')] = digest(file);
            }
        }
    }
    visit(root);
    return files;
}
let files = 0;
for (const record of manifest.packages) {
    const root = graph.packageRoot(record.name, record.version);
    assert.deepEqual(inventory(root), record.files, `Complete installed published bytes: ${record.name}`);
    if (record.patch) assert.equal(digest(join(repository, record.patch)), record.patchSha256, record.patch);
    files += Object.keys(record.files).length;
}
for (const expected of manifest.edges ?? []) {
    const parent = graph.packageRoot(expected.parent, expected.parentVersion);
    const child = physicalChild(parent, expected.child);
    if (expected.version === '-' || expected.optionalAbsent)
        assert.equal(child, undefined, `Removed direct edge: ${expected.parent}>${expected.child}`);
    else {
        assert(child, `Missing direct parent edge: ${expected.parent}>${expected.child}`);
        const version = JSON.parse(readFileSync(join(child, 'package.json'), 'utf8')).version;
        assert.equal(version, expected.version, `${expected.parent}>${expected.child}`);
    }
}
const yaml = createRequire(join(graph.packageRoot('yaml'), 'package.json'))('yaml');
const lockPackages = yaml
    .parseAllDocuments(readFileSync(join(repository, 'pnpm-lock.yaml'), 'utf8'))
    .flatMap((document) => Object.keys(document.toJSON().packages ?? {}));
for (const [prefix, version, count] of [
    ['@rolldown/binding-', '1.3.2', 16],
    ['@oxc-parser/binding-', '0.158.0', 19],
]) {
    const identities = [...new Set(lockPackages.filter((key) => key.startsWith(prefix)))];
    assert.equal(identities.length, count, `${prefix} complete optional family`);
    assert(
        identities.every((identity) => identity.endsWith(`@${version}`)),
        `${prefix} coherent versions`
    );
}
console.log(
    JSON.stringify({
        packages: manifest.packages.length,
        files,
        physicalEdges: manifest.edges?.length ?? 0,
        coherentRolldownOptionals: 16,
        coherentOxcOptionals: 19,
    })
);
