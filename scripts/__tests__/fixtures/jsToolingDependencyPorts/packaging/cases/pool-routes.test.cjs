const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { packageRequire } = require('../fixtures/installed-require.cjs');
packageRequire('app-builder-lib');
const app = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
const { CancellationToken } = app('builder-util-runtime');
const copier = packageRequire('app-builder-lib/out/util/appFileCopier');
const { FileMatcher } = packageRequire('app-builder-lib/out/fileMatcher');
const transformer = packageRequire('app-builder-lib/out/fileTransformer');
const { Packager } = packageRequire('app-builder-lib/out/packager');
const { Platform } = packageRequire('app-builder-lib');
const { Arch } = packageRequire('builder-util');
const { writeUpdateInfoFiles } = packageRequire('app-builder-lib/out/publish/updateInfoBuilder');
async function directory(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaging-pools-'));
    try {
        await run(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
test('copyAppFiles drains real symlink operations and transforms retain indexed values before return', () =>
    directory(async (dir) => {
        const src = path.join(dir, 'src'),
            dest = path.join(dir, 'dest');
        await fs.mkdir(src);
        await fs.mkdir(dest);
        await fs.writeFile(path.join(src, 'original'), 'value');
        await fs.writeFile(path.join(dest, 'original'), 'value');
        const files = [],
            metadata = new Map();
        for (const name of 'abcdefghi') {
            const file = path.join(src, name);
            await fs.symlink('original', file);
            files.push(file);
            metadata.set(file, await fs.lstat(file));
        }
        await copier.copyAppFiles(
            { src, destination: dest, files, metadata },
            { cancellationToken: new CancellationToken() },
            null
        );
        for (const name of 'abcdefghi') assert.equal(await fs.readlink(path.join(dest, name)), 'original');
        const values = {
            src,
            destination: dest,
            files,
            metadata: new Map(files.map((file) => [file, { isFile: () => true }])),
        };
        let completed = 0;
        await copier.transformFiles(
            (file) =>
                new Promise((resolve) =>
                    setImmediate(() => {
                        completed++;
                        resolve(path.basename(file) + ' transformed');
                    })
                ),
            values
        );
        assert.equal(completed, 9);
        assert.deepEqual(
            [...values.transformedFiles],
            files.map((file, index) => [index, path.basename(file) + ' transformed'])
        );
        const error = new Error('transform failure');
        await assert.rejects(
            copier.transformFiles(() => Promise.reject(error), {
                ...values,
                files: [files[0]],
            }),
            (e) => e === error
        );
    }));
test('computeFileSets electron compiler waits all actual cache writes before configuration and shim', (context) =>
    directory(async (dir) => {
        const source = path.join(dir, 'src'),
            cache = path.join(dir, 'cache');
        await fs.mkdir(path.join(source, 'nested'), { recursive: true });
        for (const name of 'abcdefghi') await fs.writeFile(path.join(source, 'nested', name + '.js'), name);
        let completed = 0;
        context.mock.method(transformer, 'createElectronCompilerHost', async (project, cacheDir) => ({
            compile: (file) =>
                new Promise((resolve, reject) =>
                    setImmediate(() =>
                        fs.writeFile(path.join(cacheDir, path.basename(file)), path.basename(file)).then(() => {
                            completed++;
                            resolve();
                        }, reject)
                    )
                ),
            saveConfiguration: async () => {
                assert.equal(completed, 9);
                await fs.writeFile(path.join(cacheDir, 'configuration'), 'finished');
            },
        }));
        const info = {
            areNodeModulesHandledExternally: false,
            tempDirManager: { getTempDir: async () => cache },
            metadata: { main: 'nested/a.js' },
        };
        const sets = await copier.computeFileSets(
            [new FileMatcher(source, path.join(dir, 'out'), (x) => x, ['**/*'])],
            null,
            { info },
            true
        );
        assert.equal(completed, 9);
        assert.equal(sets[0].files.length, 10);
        assert.equal(await fs.readFile(path.join(cache, '.cache/configuration'), 'utf8'), 'finished');
        assert.match([...sets[1].transformedFiles.values()][0], /electron-compile/);
    }));
test('doBuild drains packaging completion before target finish with actual orchestration', () =>
    directory(async (dir) => {
        const packager = Object.create(Packager.prototype);
        packager.projectDir = dir;
        packager.buildFinalizeTasks = [];
        packager.cancellationToken = new CancellationToken();
        packager.options = {
            targets: new Map([
                [
                    Platform.LINUX,
                    new Map([
                        [Arch.x64, ['fixture']],
                        [Arch.arm64, ['fixture']],
                    ]),
                ],
            ]),
        };
        packager._configuration = { directories: { output: 'output' } };
        let completed = 0,
            finished = 0;
        const target = {
            outDir: path.join(dir, 'out'),
            isAsyncSupported: true,
            finishBuild: async () => {
                assert.equal(completed, 2);
                finished++;
            },
        };
        packager.createHelper = async () => ({
            config: { concurrency: { jobs: 2 } },
            expandMacro: (x) => x,
            defaultTarget: ['fixture'],
            createTargets: (names, mapper) => {
                for (const name of names) mapper(name, () => target);
            },
            pack: async (outDir, arch) =>
                new Promise((resolve) =>
                    setImmediate(() => {
                        completed++;
                        resolve();
                    })
                ),
        });
        await packager.doBuild();
        assert.equal(completed, 2);
        assert.equal(finished, 1);
    }));
test('writeUpdateInfoFiles drains four concurrent disk and artifact events preserving merged zip order', () =>
    directory(async (dir) => {
        const emitted = [];
        let active = 0,
            peak = 0,
            release;
        const firstBatch = new Promise((resolve) => {
            release = resolve;
        });
        const packager = {
            emitArtifactCreated: async (event) => {
                active++;
                peak = Math.max(peak, active);
                if (active === 4) release();
                await firstBatch;
                assert.deepEqual(event.fileContent, await fs.readFile(event.file));
                await new Promise((resolve) => setImmediate(resolve));
                emitted.push(event);
                active--;
            },
        };
        const tasks = Array.from({ length: 9 }, (_, i) => ({
            file: path.join(dir, i + '.yml'),
            arch: Arch.x64,
            publishConfiguration: {
                provider: 'generic',
                url: 'https://fixture.invalid/' + i,
            },
            info: {
                version: '1.2.3',
                path: i + '.exe',
                sha512: 'known',
                files: [{ url: i + '.exe', sha512: 'known', size: 17 }],
            },
            packager: {},
        }));
        tasks.push({
            ...tasks[0],
            arch: null,
            info: {
                version: '1.2.3',
                path: 'first.zip',
                sha512: 'zip',
                files: [{ url: 'first.zip', sha512: 'zip', size: 22 }],
            },
        });
        await writeUpdateInfoFiles(tasks, packager);
        assert.equal(emitted.length, 9);
        assert.equal(peak, 4);
        const yaml = packageRequire('builder-util/out/buildYaml');
        const first = yaml.loadBuildYaml(await fs.readFile(path.join(dir, '0.yml'), 'utf8'));
        assert.equal(first.path, 'first.zip');
        assert.deepEqual(
            first.files.map((f) => f.url),
            ['first.zip', '0.exe']
        );
        const error = new Error('artifact boundary failure');
        await assert.rejects(
            writeUpdateInfoFiles([tasks[1]], {
                emitArtifactCreated: async () => {
                    throw error;
                },
            }),
            (e) => e === error
        );
    }));
