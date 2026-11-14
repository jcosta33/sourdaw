import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [repository, archive, output] = process.argv.slice(2);
if (!repository || !archive || !output || process.argv.length !== 5)
    throw new Error('Usage: expandTensorFlowPatch.mjs <repository> <official-tfjs-4.22.0.tgz> <new-full-patch>');
const manifest = JSON.parse(readFileSync(new URL('./provenance.json', import.meta.url), 'utf8'));
const record = manifest.packages.find((item) => item.name === '@tensorflow/tfjs');
const bytes = readFileSync(archive);
assert.equal(createHash('sha256').update(bytes).digest('hex'), record.source.sha256, 'Wrong original archive SHA256');
assert.equal(
    'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    record.source.integrity,
    'Wrong original archive SRI'
);
const compact = readFileSync(join(repository, record.patch), 'utf8');
assert.equal(createHash('sha256').update(compact).digest('hex'), record.patchSha256, 'Compact patch changed');
const directory = mkdtempSync(join(tmpdir(), 'tf-full-git-patch-'));
try {
    const tar = createRequire(resolve(repository, 'package.json'))('tar');
    await tar.x({
        file: resolve(archive),
        cwd: directory,
        filter: (name) => Object.hasOwn(record.deletedFiles, name.replace(/^package\//u, '')),
    });
    const sections = compact.split('diff --git ');
    const expanded = [sections[0]];
    for (const section of sections.slice(1)) {
        expanded.push('diff --git ', section);
        if (!section.includes('\ndeleted file mode ')) continue;
        const path = section.split('\n', 1)[0].split(' b/')[1];
        const original = readFileSync(join(directory, 'package', path));
        assert.equal(
            createHash('sha256').update(original).digest('hex'),
            record.deletedFiles[path],
            `Changed deleted input: ${path}`
        );
        assert.equal(original.includes(10), false, 'Expected the original one-line sourcemap');
        expanded.push('@@ -1 +0,0 @@\n-', original.toString('utf8'), '\n\\ No newline at end of file\n');
    }
    const full = expanded.join('');
    assert.equal(
        createHash('sha256').update(full).digest('hex'),
        record.fullGitPatchSha256,
        'Reconstructed full Git patch differs'
    );
    writeFileSync(output, full, { flag: 'wx' });
    console.log('Expanded exact original Git patch from authenticated deleted maps');
} finally {
    rmSync(directory, { recursive: true, force: true });
}
