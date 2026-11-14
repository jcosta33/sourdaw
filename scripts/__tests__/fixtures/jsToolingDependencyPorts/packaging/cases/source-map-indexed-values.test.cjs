const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const support = createRequire(packageRequire.resolve('source-map-support'));
const { SourceMapConsumer } = support('source-map-js');
const map = (name) => ({
    version: 3,
    sources: [name],
    names: ['fixture'],
    mappings: 'AAwCMA',
    sourcesContent: ['known inline source'],
});
const expected = (name) => ({
    source: name,
    line: 41,
    column: 6,
    name: 'fixture',
});
const none = { source: null, line: null, column: null, name: null };
test('indexed first column preserves before at after and adjacent sections', () => {
    const c = new SourceMapConsumer({
        version: 3,
        sections: [
            { offset: { line: 4, column: 2 }, map: map('first.ts') },
            { offset: { line: 4, column: 8 }, map: map('second.ts') },
        ],
    });
    assert.deepEqual(c.originalPositionFor({ line: 5, column: 1 }), none);
    for (const column of [2, 3, 7]) assert.deepEqual(c.originalPositionFor({ line: 5, column }), expected('first.ts'));
    for (const column of [8, 9]) assert.deepEqual(c.originalPositionFor({ line: 5, column }), expected('second.ts'));
    assert.equal(c.sourceContentFor('first.ts'), 'known inline source');
});
test('nested first column retains offset arithmetic', () => {
    const c = new SourceMapConsumer({
        version: 3,
        sections: [
            {
                offset: { line: 4, column: 2 },
                map: {
                    version: 3,
                    sections: [{ offset: { line: 2, column: 3 }, map: map('nested.ts') }],
                },
            },
        ],
    });
    assert.deepEqual(c.originalPositionFor({ line: 7, column: 2 }), none);
    assert.deepEqual(c.originalPositionFor({ line: 7, column: 3 }), expected('nested.ts'));
    assert.deepEqual(c.originalPositionFor({ line: 7, column: 4 }), expected('nested.ts'));
});
test('indexed validation and resource bounds remain strict', () => {
    assert.throws(() => new SourceMapConsumer({ ...map('x'), version: 2 }));
    for (const line of [-1, 0.5, NaN, Infinity, '1', 10000001])
        assert.throws(
            () =>
                new SourceMapConsumer({
                    version: 3,
                    sections: [{ offset: { line, column: 0 }, map: map('x') }],
                })
        );
    assert.throws(
        () =>
            new SourceMapConsumer({
                version: 3,
                sections: [
                    { offset: { line: 4, column: 0 }, map: map('x') },
                    { offset: { line: 2, column: 0 }, map: map('x') },
                ],
            })
    );
    const nested = {
        version: 3,
        sections: [{ offset: { line: 6000000, column: 0 }, map: map('x') }],
    };
    assert.throws(
        () =>
            new SourceMapConsumer({
                version: 3,
                sections: [{ offset: { line: 6000000, column: 0 }, map: nested }],
            })
    );
});
