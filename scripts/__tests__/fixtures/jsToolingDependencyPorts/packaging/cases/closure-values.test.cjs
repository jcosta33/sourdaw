const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const app = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
const util = createRequire(app.resolve('builder-util/package.json'));
async function dir(run) {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'closure-values-'));
    try {
        await run(d);
    } finally {
        await fs.rm(d, { recursive: true, force: true });
    }
}
test('cross-spawn actual shebang read retains env/direct commands and non-shebang refusal', () =>
    dir(async (d) => {
        const root = path.dirname(util.resolve('cross-spawn/package.json'));
        const readShebang = require(path.join(root, 'lib/util/readShebang'));
        for (const [line, expected] of [
            ['#!/usr/bin/env node', 'node'],
            ['#!/usr/local/bin/python -u', 'python -u'],
            ['ordinary text', null],
        ]) {
            const f = path.join(d, 'script');
            await fs.writeFile(f, line + '\nfixture');
            assert.equal(readShebang(f), expected);
        }
        assert.equal(readShebang(path.join(d, 'absent')), null);
    }));
test('actual brace expansion CJS ESM and minimatch preserve nested ranges escaping and limits', async () => {
    const mm = app('minimatch'),
        r = createRequire(app.resolve('minimatch'));
    const brace = r('brace-expansion'),
        root = path.dirname(r.resolve('brace-expansion/package.json'));
    const esm = await import(pathToFileURL(path.join(root, 'dist/esm/index.js')).href);
    for (const library of [brace, esm]) {
        assert.deepEqual(library.expand('a{b,{c,d}}{1..2}'), ['ab1', 'ab2', 'ac1', 'ac2', 'ad1', 'ad2']);
        assert.deepEqual(library.expand(String.raw`a\{b,c\}`), ['a{b,c}']);
        assert.equal(library.expand('{1..100001}').length, 100000);
    }
    assert.equal(mm.minimatch('src/音楽.ts', 'src/{audio,音楽}.{ts,js}'), true);
    assert.equal(mm.minimatch('src/unrelated.js', 'src/{audio,音楽}.ts'), false);
});
test('promise-retry current err-code/retry route preserves attempts result and exact rejection', async () => {
    const r = createRequire(app.resolve('@electron/rebuild'));
    const retry = r('promise-retry');
    const error = new Error('retry original');
    const attempts = [];
    assert.equal(
        await retry(
            (again, n) => {
                attempts.push(n);
                if (n < 3) again(error);
                return 'finished';
            },
            { retries: 2, minTimeout: 1, maxTimeout: 1, randomize: false }
        ),
        'finished'
    );
    assert.deepEqual(attempts, [1, 2, 3]);
    await assert.rejects(
        retry((again) => again(error), { retries: 0 }),
        (e) => e === error
    );
    const unrelated = new Error('not retry');
    await assert.rejects(
        retry(
            () => {
                throw unrelated;
            },
            { retries: 2, minTimeout: 1 }
        ),
        (e) => e === unrelated
    );
});
test('app schema validator actual AJV URI resolution accepts external IDs and rejects invalid local references', () => {
    const Ajv = app('ajv');
    const ajv = new Ajv({ strict: false });
    ajv.addSchema({
        $id: 'https://fixture.invalid/schemas/types.json',
        definitions: { name: { type: 'string', minLength: 2 } },
    });
    const validate = ajv.compile({
        $id: 'https://fixture.invalid/schemas/root.json',
        type: 'object',
        properties: { name: { $ref: './types.json#/definitions/name' } },
        required: ['name'],
        additionalProperties: false,
    });
    assert.equal(validate({ name: '音楽' }), true);
    assert.equal(validate({ name: 'x' }), false);
    assert.equal(validate.errors[0].keyword, 'minLength');
    assert.throws(
        () =>
            ajv.compile({
                $id: 'https://fixture.invalid/schemas/missing.json',
                $ref: 'absent.json#/missing',
            }),
        /resolve reference/
    );
    const { validateSchema } = packageRequire('app-builder-lib/out/util/config/schemaValidator');
    const schema = {
        type: 'object',
        properties: { mode: { enum: ['valid'] } },
        additionalProperties: false,
    };
    assert.doesNotThrow(() => validateSchema(schema, { mode: 'valid' }));
    assert.throws(() => validateSchema(schema, { mode: 'invalid' }), /Invalid configuration object/);
});
test(
    'unzipper actual ParseOne Extract and error routes preserve archive bytes and zip slip refusal',
    { timeout: 5000 },
    () =>
        dir(async (d) => {
            const unzip = app('unzipper'),
                zip = path.join(__dirname, '../fixtures/known.zip');
            const one = unzip.ParseOne(/^one\.txt$/);
            const chunks = [];
            const sink = new (require('node:stream').Writable)({
                write(chunk, encoding, done) {
                    chunks.push(Buffer.from(chunk));
                    done();
                },
            });
            const oneDone = require('node:events').once(sink, 'finish');
            one.pipe(sink);
            nativeFs.createReadStream(zip).pipe(one);
            await oneDone;
            assert.equal(Buffer.concat(chunks).toString(), 'known Ω bytes');
            const output = path.join(d, 'output');
            const extract = unzip.Extract({ path: output });
            const done = extract.promise();
            nativeFs.createReadStream(zip).pipe(extract);
            await done;
            assert.deepEqual(await fs.readFile(path.join(output, 'nested/音楽.bin')), Buffer.from([7, 2, 9, 0]));
            assert.equal(await fs.readFile(path.join(output, 'one.txt'), 'utf8'), 'known Ω bytes');
            await assert.rejects(fs.stat(path.join(d, 'escape.txt')), (e) => e.code === 'ENOENT');
            const absent = unzip.ParseOne(/^absent$/);
            const rejected = require('node:events').once(absent, 'error');
            absent.resume();
            nativeFs.createReadStream(zip).pipe(absent);
            assert.equal((await rejected)[0].message, 'PATTERN_NOT_FOUND');
        })
);
test('actual form-data inherited toStringTag uses latest intrinsic getter without changing serialization', () => {
    const publish = createRequire(packageRequire.resolve('electron-publish/package.json'));
    const form = publish('form-data');
    const value = new form();
    assert.equal(Object.prototype.toString.call(value), '[object FormData]');
    value.setBoundary('fixed');
    value.append('name', 'Ω');
    assert.ok(value.getBuffer().includes(Buffer.from('Ω')));
});
