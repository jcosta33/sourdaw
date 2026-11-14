const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const req = createRequire(require('node:fs').realpathSync('node_modules/dependency-cruiser/src/main/index.mjs'));
const root = path.dirname(req.resolve('prompts'));
const preq = createRequire(path.join(root, 'index.js'));
assert.equal(typeof preq('string-width').default, 'function');

let failures = [];
function check(label, actual, expected) {
    try {
        assert.deepEqual(actual, expected);
    } catch (e) {
        failures.push({ label, actual, expected });
    }
}
for (const tree of ['lib', 'dist']) {
    const clear = require(path.join(root, tree, 'util/clear'));
    const lines = require(path.join(root, tree, 'util/lines'));
    const wrap = require(path.join(root, tree, 'util/wrap'));
    const one = '\x1b[2K\x1b[G',
        two = '\x1b[2K\x1b[1A\x1b[2K\x1b[G';
    for (const [s, w] of [
        ['ab', 2],
        ['界', 2],
        ['é', 1],
        ['👩‍💻', 2],
        ['\x1b[31m界\x1b[39m', 2],
    ]) {
        check(tree + ' lines ' + s, lines(s, 1), w);
        check(tree + ' clear ' + s, clear(s, 1), w === 1 ? one : two);
    }
    check(tree + ' empty lines', lines('', 4), 0);
    check(tree + ' empty clear', clear('', 4), one);
    check(tree + ' no width lines', lines('a\nb'), 2);
    check(tree + ' no width clear', clear('x'), '\x1b[2K\x1b[1G');
    check(tree + ' ascii wrap', wrap('ab c', { width: 6 }), ' ab c');
    check(tree + ' boundary', clear('界', 2), one);
    check(tree + ' multiline', lines('界\né', 1), 3);
    check(tree + ' clear multiline', clear('界\né', 1), '\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G');
    check(tree + ' wrap cjk', wrap('界 x', { width: 5 }), ' 界\nx');
    check(tree + ' wrap combining', wrap('é x', { width: 5 }), ' é x');
    check(tree + ' wrap margin', wrap('界 x', { width: 7, margin: 2 }), '   界\n  x');
    check(tree + ' wrap ansi', wrap('\x1b[31m界\x1b[39m x', { width: 5 }), ' \x1b[31m界\x1b[39m\nx');
}
if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
} else console.log('literal cell-width oracle passed for lib and dist');
