import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
if (process.argv.length !== 4) throw new Error('Usage: compare-wire.mjs <embedded-capture> <candidate-capture>');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const original = read(process.argv[2]);
const candidate = read(process.argv[3]);
assert.deepEqual(candidate.valid, original.valid);
assert.deepEqual(candidate.literals, original.literals);
const rejectionContracts = new Map([
    ['truncated string', { name: 'RangeError', message: /^index out of range:/ }],
    ['ten continuation bytes', { name: 'Error', message: /^invalid varint encoding$/ }],
    ['overflowing length', { name: 'Error', message: /^invalid length encoding$/ }],
    ['truncated int64', { name: 'RangeError', message: /^index out of range:/ }],
    ['invalid wire type', { name: 'Error', message: /^invalid wire type 7 at offset 1$/ }],
    ['unterminated group', { name: 'RangeError', message: /^index out of range:/ }],
]);
const strictEdges = (capture) => capture.edges.filter((entry) => !rejectionContracts.has(entry.name));
assert.deepEqual(strictEdges(candidate), strictEdges(original));
for (const [name, expected] of rejectionContracts) {
    for (const representation of ['Buffer', 'Uint8Array']) {
        const match = candidate.edges.filter((entry) => entry.name === name && entry.representation === representation);
        assert.equal(match.length, 1, `${name}/${representation} capture is required`);
        assert.equal(match[0].error?.name, expected.name, `${name}/${representation}`);
        assert.match(match[0].error.message, expected.message, `${name}/${representation}`);
    }
}
// Original malformed captures remain intact on disk for causal evidence, including prior acceptance.
