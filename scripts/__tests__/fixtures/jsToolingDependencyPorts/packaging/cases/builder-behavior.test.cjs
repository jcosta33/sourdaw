const { test } = require('node:test');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const builderFs = packageRequire('builder-util/out/fs');
const helperPath = packageRequire.resolve('app-builder-lib/out/util/NodeModuleCopyHelper');
const { NodeModuleCopyHelper } = require(helperPath);
const helperRequire = createRequire(helperPath);
const helperFs = helperRequire('fs-extra');
const { removeUnusedLanguagesIfNeeded } = packageRequire('app-builder-lib/out/electron/ElectronFramework');
const { Platform } = packageRequire('app-builder-lib');

function deferred() {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
async function withDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sourdaw-builder-pool-'));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
async function exerciseOrderAndBound(obj, key, dir, run) {
    const original = obj[key];
    const firstBatch = deferred();
    const release = deferred();
    let active = 0,
        peak = 0,
        started = 0;
    obj[key] = async (file) => {
        if (path.dirname(file) !== dir) return original(file);
        active++;
        peak = Math.max(peak, active);
        started++;
        if (started === 8) firstBatch.resolve();
        try {
            await release.promise;
            // Cause a to finish after its peers; return still must follow sorted names.
            if (path.basename(file) === 'a') await new Promise((resolve) => setImmediate(resolve));
            return await original(file);
        } finally {
            active--;
        }
    };
    try {
        const operation = run();
        await firstBatch.promise;
        assert.equal(started, 8);
        release.resolve();
        const result = await operation;
        assert.deepEqual(
            result.map((p) => path.basename(p)),
            ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
        );
        assert.equal(peak, 8);
    } finally {
        obj[key] = original;
    }
    // Competing failures: b rejects first while a and all other work are held.
    const allStarted = deferred(),
        failB = deferred(),
        releaseRest = deferred();
    const errorA = new Error('later a'),
        errorB = new Error('first b');
    let failureStarted = 0;
    obj[key] = async (file) => {
        if (path.dirname(file) !== dir) return original(file);
        if (++failureStarted === 8) allStarted.resolve();
        if (path.basename(file) === 'b') {
            await failB.promise;
            throw errorB;
        }
        await releaseRest.promise;
        if (path.basename(file) === 'a') throw errorA;
        return original(file);
    };
    try {
        const operation = run();
        await allStarted.promise;
        failB.resolve();
        await assert.rejects(operation, (e) => e === errorB);
    } finally {
        releaseRest.resolve();
        obj[key] = original;
    }
}

test('real builder traversals preserve ordering, bounded concurrency, and failures', async () =>
    withDir(async (dir) => {
        for (const name of 'abcdefghi') await fs.writeFile(path.join(dir, name), name);
        await exerciseOrderAndBound(fs, 'lstat', dir, () => builderFs.walk(dir));
        const helper = Object.create(NodeModuleCopyHelper.prototype);
        helper.filter = null;
        helper.metadata = new Map();
        helper.handleFile = () => null;
        helper.packager = {
            appInfo: { type: 'commonjs' },
            config: {},
            getWorkspaceRoot: async () => dir,
        };
        await exerciseOrderAndBound(helperFs, 'lstat', dir, () =>
            helper.collectNodeModules({ dir, name: 'fixture' }, [], '/destination')
        );
    }));

test('real copy and locale cleanup finish before returning', async () =>
    withDir(async (dir) => {
        const src = path.join(dir, 'src'),
            dest = path.join(dir, 'dest');
        await fs.mkdir(src);
        await fs.writeFile(path.join(src, 'file'), 'payload');
        await fs.symlink('file', path.join(src, 'link'));
        await builderFs.copyDir(src, dest, { isUseHardLink: builderFs.DO_NOT_USE_HARD_LINKS });
        assert.equal(await fs.readFile(path.join(dest, 'file'), 'utf8'), 'payload');
        assert.equal(await fs.readlink(path.join(dest, 'link')), 'file');
        const locales = path.join(dir, 'locales');
        await fs.mkdir(locales);
        for (const locale of ['en-US', 'fr', 'de']) await fs.writeFile(path.join(locales, `${locale}.pak`), locale);
        await removeUnusedLanguagesIfNeeded({
            appOutDir: dir,
            packager: {
                config: { electronLanguages: ['en'] },
                platformSpecificBuildOptions: {},
                platform: Platform.LINUX,
                getResourcesDir: () => path.join(dir, 'resources'),
            },
        });
        assert.deepEqual(await fs.readdir(locales), ['en-US.pak']);
    }));
