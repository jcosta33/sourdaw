'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadFormat } = require('../fixtures/installed-cache.cjs');
async function withDirectory(run) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-port-'));
    try {
        return await run(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}
for (const format of ['cjs', 'esm']) {
    test(format + ': real flat-cache disk roundtrip preserves circular objects and failure visibility', () =>
        withDirectory(async (dir) => {
            const { FlatCache } = await loadFormat('flat-cache', format);
            const cache = new FlatCache({ cacheDir: dir, cacheId: 'roundtrip' });
            const value = { unicode: 'Ω 音楽', number: 0, boolean: false };
            value.self = value;
            cache.set('value', value);
            cache.save();
            assert.ok((await fs.stat(cache.cacheFilePath)).size > 0);
            const reopened = new FlatCache({ cacheDir: dir, cacheId: 'roundtrip' });
            reopened.load();
            const actual = reopened.get('value');
            assert.equal(actual.self, actual);
            assert.equal(actual.unicode, value.unicode);
            assert.equal(actual.number, 0);
            assert.equal(actual.boolean, false);
            actual.unicode = 'mutated';
            assert.equal(reopened.get('value').unicode, value.unicode);
            await fs.writeFile(reopened.cacheFilePath, 'invalid JSON fixture');
            const errors = [];
            reopened.on('error', (error) => errors.push(error));
            reopened.load();
            assert.ok(errors[0] instanceof SyntaxError);
            assert.throws(() => reopened.loadFile(reopened.cacheFilePath), SyntaxError);
            const optional = new FlatCache({ cacheDir: dir, cacheId: 'roundtrip' });
            assert.doesNotThrow(() => optional.load(), 'requires the separately owned flat-cache Hookified port');
        })
    );
    test(format + ': actual file-entry content cache reports cold hit modification and deletion', () =>
        withDirectory(async (dir) => {
            const file = path.join(dir, 'source.js');
            const cacheDirectory = path.join(dir, 'store');
            await fs.writeFile(file, 'const a = 1;');
            const { create } = await loadFormat('file-entry-cache', format);
            const options = { useCheckSum: true, useModifiedTime: false, cwd: dir };
            const first = create('content', cacheDirectory, options);
            assert.equal(first.getFileDescriptor(file).changed, true);
            first.reconcile();
            const hit = create('content', cacheDirectory, options);
            assert.equal(hit.getFileDescriptor(file).changed, false);
            const stat = await fs.stat(file);
            await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 10000));
            assert.equal(hit.getFileDescriptor(file).changed, false, 'mtime alone cannot invalidate content strategy');
            await fs.writeFile(file, 'const b = 1;');
            await fs.utimes(file, stat.atime, stat.mtime);
            assert.equal(
                hit.getFileDescriptor(file).changed,
                true,
                'same-size same-mtime changed bytes must invalidate'
            );
            hit.reconcile();
            const changed = create('content', cacheDirectory, options);
            assert.equal(changed.getFileDescriptor(file).changed, false);
            await fs.unlink(file);
            const missing = changed.getFileDescriptor(file);
            assert.equal(missing.notFound, true);
            assert.equal(missing.err.code, 'ENOENT');
            changed.reconcile();
            assert.equal(changed.cache.keys().includes(file), false);
        })
    );
}
