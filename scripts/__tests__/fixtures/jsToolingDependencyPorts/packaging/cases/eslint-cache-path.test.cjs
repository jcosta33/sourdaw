'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../fixtures/installed-cache.cjs');
test('actual content cache avoids rule execution on hit and invalidates bytes/config/corruption', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eslint-cache-port-'));
    try {
        const file = path.join(dir, 'fixture.js'),
            cacheLocation = path.join(dir, 'eslint-cache');
        await fs.writeFile(file, 'const a = 1;');
        let executions = 0;
        const plugin = {
            meta: { name: 'fixture-cache', version: '1' },
            rules: {
                observe: {
                    meta: {
                        type: 'problem',
                        schema: [{ type: 'string' }],
                        messages: { observed: 'Observed {{marker}}.' },
                    },
                    create(context) {
                        executions++;
                        return {
                            Program(node) {
                                context.report({
                                    node,
                                    messageId: 'observed',
                                    data: { marker: context.options[0] },
                                });
                            },
                        };
                    },
                },
            },
        };
        const { ESLint } = load('eslint');
        const make = (marker) =>
            new ESLint({
                cwd: dir,
                overrideConfigFile: true,
                cache: true,
                cacheLocation,
                cacheStrategy: 'content',
                concurrency: 'off',
                overrideConfig: [
                    {
                        files: ['**/*.js'],
                        plugins: { fixture: plugin },
                        rules: { 'fixture/observe': ['error', marker] },
                    },
                ],
            });
        const first = make('one');
        const cold = await first.lintFiles([file]);
        assert.equal(executions, 1);
        assert.equal(cold[0].messages[0].message, 'Observed one.');
        assert.ok((await fs.stat(cacheLocation)).size > 0);
        const warm = await make('one').lintFiles([file]);
        assert.equal(executions, 1, 'reopened actual disk cache must skip the producing rule');
        assert.deepEqual(warm[0].messages, cold[0].messages);
        const stat = await fs.stat(file);
        await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 10000));
        await make('one').lintFiles([file]);
        assert.equal(executions, 1, 'content cache ignores mtime-only changes');
        await fs.writeFile(file, 'const b = 1;');
        await fs.utimes(file, stat.atime, stat.mtime);
        await make('one').lintFiles([file]);
        assert.equal(executions, 2, 'same-size same-mtime bytes must invalidate');
        const configChanged = await make('two').lintFiles([file]);
        assert.equal(executions, 3);
        assert.equal(configChanged[0].messages[0].message, 'Observed two.');
        await make('two').lintFiles([file]);
        assert.equal(executions, 3);
        await fs.writeFile(cacheLocation, 'invalid persisted JSON fixture');
        const recovered = await make('two').lintFiles([file]);
        assert.equal(executions, 4, 'corrupt persistence must cause actual cold lint, never stale acceptance');
        assert.equal(recovered[0].messages[0].message, 'Observed two.');
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
