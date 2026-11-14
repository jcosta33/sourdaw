'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function observe(variant) {
    assert.ok(process.env.PACKAGING_REQUIRE_FROM);
    const child = spawnSync(process.execPath, [path.join(__dirname, '../fixtures/stack-worker.cjs'), variant], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, FORCE_COLOR: '0' },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.split('\n').find((line) => line.startsWith('STACK_FIXTURE:'));
    assert.ok(line, child.stdout + child.stderr);
    return JSON.parse(line.slice('STACK_FIXTURE:'.length));
}
for (const variant of ['external', 'inline', 'indexed'])
    test('actual synchronous source-map stack and inline source: ' + variant, () => {
        const result = observe(variant);
        assert.equal(result.direct.source, result.expectedOriginal);
        assert.equal(result.direct.line, 41);
        assert.equal(result.direct.column, 6);
        assert.ok(result.stack.includes(result.expectedOriginal + ':41:7'), result.stack);
        assert.match(result.source, /throw new Error\("fixture failure"\)/);
        assert.match(result.source, /\^/);
    });
for (const variant of ['missing', 'unmapped'])
    test('actual stack preserves unmapped generated position: ' + variant, () => {
        const result = observe(variant);
        assert.equal(result.direct.source, result.generated);
        assert.equal(result.direct.line, 1);
        assert.ok(result.stack.includes(result.generated + ':1:'), result.stack);
    });

test('actual custom retrieval error propagates unchanged', () => {
    assert.equal(observe('retrieval-error').retrievalFailurePreserved, true);
});
