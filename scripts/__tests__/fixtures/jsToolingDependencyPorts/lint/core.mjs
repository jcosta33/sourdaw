import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import stylistic from '@stylistic/eslint-plugin';
import a11y from 'eslint-plugin-jsx-a11y-x';
import comments from '@eslint-community/eslint-plugin-eslint-comments';

function fixture(files) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-eslint-latest-'));
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
}

function engine(rule, options, extra = {}) {
    return new ESLint({
        overrideConfigFile: true,
        overrideConfig: [
            { plugins: { probe: { rules: { options: rule } } }, rules: { 'probe/options': ['error', ...options] } },
        ],
        ...extra,
    });
}

function inspectRule(schema) {
    return {
        meta: { schema },
        create(context) {
            return {
                Program(node) {
                    context.report({ node, message: JSON.stringify(context.options) });
                },
            };
        },
    };
}

function ruleTester() {
    RuleTester.describe = (_name, run) => run();
    RuleTester.it = (_name, run) => run();
    return new RuleTester();
}

async function schemas() {
    const schema = {
        $id: 'https://sourdaw.test/rule-options.json',
        type: 'array',
        minItems: 1,
        maxItems: 1,
        'x-documentation': 'Extension annotation is permitted by draft-04.',
        definitions: {
            mode: { id: 'mode', type: 'string', enum: ['safe'] },
            settings: {
                type: 'object',
                properties: {
                    mode: { $ref: 'mode' },
                    limit: { type: 'number', minimum: 0, exclusiveMinimum: true, default: 3 },
                    next: { $ref: '#/definitions/settings' },
                },
                required: ['mode'],
                additionalProperties: false,
            },
        },
        items: [{ $ref: '#/definitions/settings' }],
    };
    const rule = inspectRule(schema);
    const [positive] = await engine(rule, [{ mode: 'safe' }]).lintText('export const value = true;');
    assert.deepEqual(
        positive.messages.map((message) => message.message),
        ['[{"mode":"safe","limit":3}]']
    );
    assert.equal(schema.$id, 'https://sourdaw.test/rule-options.json');
    assert.equal(Object.hasOwn(schema, 'id'), false);
    await assert.rejects(engine(rule, [{ mode: 'unsafe' }]).lintText('export {};'), /allowed values/);
    await assert.rejects(engine(rule, [{ mode: 'safe', limit: 0 }]).lintText('export {};'), /must be > 0/);
    await assert.rejects(
        engine(rule, [{ mode: 'safe', next: { mode: 'unsafe' } }]).lintText('export {};'),
        /allowed values/
    );
    await assert.rejects(
        engine(rule, [{ mode: 'safe', typo: true }]).lintText('export {};'),
        /Unexpected property "typo"\. Expected properties: "mode", "limit", "next"/
    );
    await assert.rejects(
        engine(inspectRule({ ...schema, id: 'https://sourdaw.test/other.json' }), [{ mode: 'safe' }]).lintText(
            'export {};'
        ),
        /schema \$id is different from id/
    );
    await assert.rejects(
        engine(inspectRule({ type: 'array', items: [{ $ref: '#/definitions/missing' }] }), ['unsafe']).lintText(
            'export {};'
        ),
        /reference|ref/i
    );
    const email = inspectRule([{ type: 'string', format: 'email' }]);
    assert.equal((await engine(email, ['person@example.com']).lintText('export {};'))[0].errorCount, 1);
    await assert.rejects(engine(email, ['not an email']).lintText('export {};'), /format "email"/);
    await assert.rejects(
        engine(inspectRule([{ type: 'string', format: 'nonexistent-sourdaw-format' }]), ['x']).lintText('export {};'),
        /unknown format/
    );
    for (const [format, accepted, rejected] of [
        ['time', '12:30:45Z', '12:30:45'],
        ['date-time', '2026-11-13T12:30:45Z', '2026-11-13T12:30:45'],
        ['ipv4', '1.2.3.4', '001.002.003.004'],
        ['ipv6', '::1', ' ::1%loopback '],
        ['url', 'https://example.com/path', 'not a URL'],
    ]) {
        const formatted = inspectRule([{ type: 'string', format }]);
        assert.equal((await engine(formatted, [accepted]).lintText('export {};'))[0].errorCount, 1);
        await assert.rejects(engine(formatted, [rejected]).lintText('export {};'), new RegExp(`format "${format}"`));
    }
    const finite = inspectRule([{ type: 'number' }]);
    for (const invalidNumber of [Number.NaN, Number.POSITIVE_INFINITY]) {
        await assert.rejects(engine(finite, [invalidNumber]).lintText('export {};'), /must be number/);
    }
    const invalidDefault = inspectRule([{ type: 'object', properties: { value: { type: 'number', default: 'bad' } } }]);
    await assert.rejects(engine(invalidDefault, [{}]).lintText('export {};'), /must be number/);
    const instanceDefault = inspectRule([
        {
            type: 'object',
            properties: { literal: { type: 'object', default: { $id: 'instance-id', id: 'ordinary-data' } } },
        },
    ]);
    assert.equal(
        (await engine(instanceDefault, [{}]).lintText('export {};'))[0].messages[0].message,
        '[{"literal":{"$id":"instance-id","id":"ordinary-data"}}]'
    );
    const escaped = inspectRule({
        type: 'array',
        definitions: { 'a/b~c': { type: 'string', enum: ['escaped'] } },
        items: [{ $ref: '#/definitions/a~1b~0c' }],
    });
    assert.equal((await engine(escaped, ['escaped']).lintText('export {};'))[0].errorCount, 1);
    await assert.rejects(engine(escaped, ['wrong']).lintText('export {};'), /allowed values/);
    const union = inspectRule([
        {
            anyOf: [
                { type: 'string', enum: ['safe'] },
                { type: 'number', minimum: 1 },
            ],
        },
    ]);
    assert.equal((await engine(union, [2]).lintText('export {};'))[0].errorCount, 1);
    await assert.rejects(engine(union, [false]).lintText('export {};'), /must match a schema in anyOf/);
    // Explicit schema:false and disabled-rule behavior are part of ESLint's own validation contract.
    assert.equal(
        (await engine(inspectRule(false), [{ arbitrary: true }]).lintText('export {};'))[0].messages[0].message,
        '[{"arbitrary":true}]'
    );
    const disabled = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [
            {
                plugins: { probe: { rules: { options: rule } } },
                rules: { 'probe/options': ['off', { mode: 'unsafe' }] },
            },
        ],
    });
    assert.equal((await disabled.lintText('export {};'))[0].errorCount, 0);
    const tuple = inspectRule([
        { type: 'string', enum: ['first'] },
        { type: 'number', minimum: 1 },
    ]);
    assert.equal((await engine(tuple, ['first', 2]).lintText('export {};'))[0].errorCount, 1);
    await assert.rejects(engine(tuple, ['first', 0]).lintText('export {};'), /must be >= 1/);
    // Draft-04 ignores validation siblings beside a reference; neither a new dialect nor a dropped ref may change it.
    const siblings = inspectRule({
        type: 'array',
        definitions: { value: { type: 'string' } },
        items: [{ $ref: '#/definitions/value', type: 'number' }],
    });
    assert.equal((await engine(siblings, ['actual string']).lintText('export {};'))[0].errorCount, 1);
    await assert.rejects(engine(siblings, [3]).lintText('export {};'), /must be string/);

    const silent = { meta: { schema: { type: 'array', 'x-note': 'annotation' } }, create: () => ({}) };
    ruleTester().run('annotation', silent, { valid: ['export {};'], invalid: [] });
    const badSchema = { meta: { schema: { type: 'array', items: [{ type: 42 }] } }, create: () => ({}) };
    assert.throws(
        () => ruleTester().run('bad-schema', badSchema, { valid: ['export {};'], invalid: [] }),
        (error) => /Schema for rule bad-schema is invalid/.test(error.message) && /items\[0\]\.type/.test(error.message)
    );
    for (const schema of [
        { type: 'array', default: [] },
        {
            type: 'array',
            items: [{ type: 'object', anyOf: [{ properties: { ignored: { type: 'number', default: 1 } } }] }],
        },
    ]) {
        const ignored = inspectRule(schema);
        const options = schema.items ? [{}] : [];
        assert.equal((await engine(ignored, options).lintText('export {};'))[0].errorCount, 1);
        const tested = { ...ignored, create: () => ({}) };
        assert.throws(
            () =>
                ruleTester().run('ignored-default', tested, { valid: [{ code: 'export {};', options }], invalid: [] }),
            /default is ignored/
        );
    }
}

async function enumeration() {
    const root = fixture({
        'eslint.config.js': `module.exports = [
{ ignores: ['src/ignored/**/*', '!src/ignored/**/', '!src/ignored/keep.js'] },
{ files: ['**/*.{js,mjs}'], rules: { 'no-debugger': 'error' } }
];`,
        'eslint.config.mjs': 'export default [{ rules: { "no-alert": "error" } }];',
        'src/main.js': 'debugger;',
        'src/.hidden.js': 'debugger;',
        'src/nested/one.mjs': 'debugger;',
        'src/literal[1].js': 'debugger;',
        'src/ignored/drop.js': 'debugger;',
        'src/ignored/keep.js': 'debugger;',
        'nested/eslint.config.mjs': `export default [{ rules: { 'no-alert': 'error' } }];`,
        'nested/child/input.js': 'alert("actual nested config");',
    });
    try {
        const eslint = new ESLint({ cwd: root });
        const result = await eslint.lintFiles(['src/**/*.{js,mjs}']);
        assert.deepEqual(result.map((item) => relative(root, item.filePath).replaceAll('\\', '/')).sort(), [
            'src/.hidden.js',
            'src/ignored/keep.js',
            'src/literal[1].js',
            'src/main.js',
            'src/nested/one.mjs',
        ]);
        assert(result.every((item) => item.messages.length === 1 && item.messages[0].ruleId === 'no-debugger'));
        assert.equal((await eslint.lintFiles(['src/literal[1].js']))[0].messages[0].ruleId, 'no-debugger');
        assert.equal((await eslint.lintFiles([join('src', 'nested', 'one.mjs')]))[0].messages[0].ruleId, 'no-debugger');
        const [ignored] = await eslint.lintFiles(['src/ignored/drop.js']);
        assert.equal(ignored.warningCount, 1);
        assert.match(ignored.messages[0].message, /ignored/);
        await assert.rejects(eslint.lintFiles(['src/ignored/drop*.js']), /ignored/);
        await assert.rejects(eslint.lintFiles(['src/missing/**/*.js']), /No files matching/);
        const nonfatal = new ESLint({ cwd: root, errorOnUnmatchedPattern: false });
        assert.deepEqual(await nonfatal.lintFiles(['src/missing/**/*.js']), []);
        const nested = new ESLint({ cwd: join(root, 'nested/child') });
        const [near] = await nested.lintFiles(['input.js']);
        assert.deepEqual(
            near.messages.map((message) => message.ruleId),
            ['no-alert']
        );
        await assert.rejects(
            new ESLint({ cwd: root, overrideConfigFile: join(root, 'missing.config.mjs') }).lintFiles(['src/main.js']),
            /ENOENT|Cannot find/
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function rules() {
    const config = [
        {
            files: ['**/*.jsx', '**/*.js'],
            languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
            plugins: { '@stylistic': stylistic, 'jsx-a11y-x': a11y, 'eslint-comments': comments },
            rules: {
                '@stylistic/spaced-comment': ['error', 'always'],
                'jsx-a11y-x/lang': 'error',
                'jsx-a11y-x/label-has-associated-control': [
                    'error',
                    { labelComponents: ['*Label'], controlComponents: ['*Input'], assert: 'either' },
                ],
                'no-restricted-imports': [
                    'error',
                    { patterns: [{ group: ['blocked/**', '!blocked/allowed'], caseSensitive: true }] },
                ],
                'no-warning-comments': ['error', { terms: ['todo(x)'], location: 'anywhere' }],
                'eslint-comments/no-restricted-disable': ['error', 'no-debugger'],
            },
        },
    ];
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
    const valid =
        'import "blocked/allowed";\n// actual prose\nexport const Panel = () => <><html lang="en-GB" /><CustomLabel>Name<CustomInput /></CustomLabel></>;';
    assert.deepEqual((await eslint.lintText(valid, { filePath: 'fixture.jsx' }))[0].messages, []);
    const invalid =
        'import "blocked/forbidden";\n//todo(x)\n/* eslint-disable no-debugger */\nexport const Panel = () => <><html lang="invalid-sourdaw-tag" /><CustomLabel /></>;';
    const [result] = await eslint.lintText(invalid, { filePath: 'fixture.jsx' });
    for (const ruleId of [
        '@stylistic/spaced-comment',
        'jsx-a11y-x/lang',
        'jsx-a11y-x/label-has-associated-control',
        'no-restricted-imports',
        'no-warning-comments',
        'eslint-comments/no-restricted-disable',
    ]) {
        assert(
            result.messages.some((message) => message.ruleId === ruleId),
            `Actual rule did not report: ${ruleId}`
        );
    }
    // Compare a direct core rule's case-sensitive, negated and relative patterns on the actual ignore engine.
    const restricted = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [
            { rules: { 'no-restricted-modules': ['error', { patterns: ['blocked/**', '!blocked/allowed'] }] } },
        ],
    });
    assert.equal((await restricted.lintText('require("blocked/allowed");'))[0].errorCount, 0);
    assert.equal(
        (await restricted.lintText('require("blocked/forbidden");'))[0].messages[0].ruleId,
        'no-restricted-modules'
    );
}

async function cacheAndCli() {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve('eslint/package.json');
    const eslintRequire = createRequire(manifest);
    const fileCache = eslintRequire.resolve('file-entry-cache');
    const { FlatCache } = createRequire(fileCache)('flat-cache');
    const root = fixture({
        'eslint.config.mjs': 'export default [{ rules: { "no-debugger": "error" } }];',
        'source.js': 'debugger;',
        'broken-cache': 'invalid serialized cache',
    });
    try {
        const broken = new FlatCache({ cacheDir: root, cacheId: 'broken-cache' });
        assert.doesNotThrow(() => broken.load());
        const failures = [];
        broken.on('error', (error) => failures.push(error));
        broken.load();
        assert.equal(failures.length, 1);
        assert(failures[0] instanceof SyntaxError);
        const saved = new FlatCache({ cacheDir: root, cacheId: 'working-cache' });
        saved.set('actual', { value: 7 });
        saved.save();
        const loaded = new FlatCache({ cacheDir: root, cacheId: 'working-cache' });
        loaded.load();
        assert.deepEqual(loaded.get('actual'), { value: 7 });
        const cached = new ESLint({ cwd: root, cache: true, cacheLocation: join(root, '.eslintcache') });
        assert.equal((await cached.lintFiles(['source.js']))[0].messages[0].ruleId, 'no-debugger');
        assert.equal((await cached.lintFiles(['source.js']))[0].messages[0].ruleId, 'no-debugger');
        const cli = spawnSync(
            process.execPath,
            [join(dirname(manifest), 'bin/eslint.js'), '--cache-strategyy', 'metadata'],
            {
                cwd: root,
                encoding: 'utf8',
                timeout: 10_000,
            }
        );
        assert.equal(cli.error, undefined);
        assert.equal(cli.status, 2);
        assert.match(cli.stderr, /Invalid option '--cache-strategyy'.*perhaps you meant '--cache-strategy'/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const cases = { schemas, enumeration, rules, cacheAndCli };
const name = process.argv[2];
assert.equal(typeof cases[name], 'function');
await cases[name]();
console.log(JSON.stringify({ case: name, platform: process.platform, complete: true }));
