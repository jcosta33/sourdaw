'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { wireContract } = require('./wire.fixture.cjs');
if (process.argv.length !== 4) throw new Error('Usage: run-wire.cjs <generated-module> <new-capture-json>');
const generated = require(path.resolve(process.argv[2]));
const { onnx } = generated;
const valid = {
    Buffer: wireContract(generated),
    Uint8Array: wireContract(generated, (bytes) => Uint8Array.from(bytes)),
};
const literalCases = [
    { name: 'empty model defaults', type: onnx.ModelProto, hex: '', reencoded: '' },
    { name: 'explicit zero presence', type: onnx.ModelProto, hex: '0800', reencoded: '0800' },
    { name: 'UTF8 non-ASCII', type: onnx.ModelProto, hex: '1206c3a9f09f8eb5', reencoded: '1206c3a9f09f8eb5' },
    { name: 'unknown varint discarded', type: onnx.ModelProto, hex: '0809980607', reencoded: '0809' },
    { name: 'unknown bytes discarded', type: onnx.ModelProto, hex: '0809a20603616263', reencoded: '0809' },
    { name: 'unknown group skipped', type: onnx.ModelProto, hex: '0809bb060801bc06', reencoded: '0809' },
    {
        name: 'signed dimension',
        type: onnx.TensorShapeProto.Dimension,
        hex: '08ffffffffffffffffff01',
        reencoded: '08ffffffffffffffffff01',
    },
    {
        name: 'float and negative zero',
        type: onnx.TensorProto,
        hex: '100122080000003f00000080',
        reencoded: '100122080000003f00000080',
    },
    { name: 'double', type: onnx.TensorProto, hex: '100b5208000000000000f83f', reencoded: '100b5208000000000000f83f' },
];
const literals = [];
for (const item of literalCases) {
    for (const representation of ['Buffer', 'Uint8Array']) {
        const bytes = Buffer.from(item.hex, 'hex');
        const decoded = item.type.decode(representation === 'Buffer' ? bytes : Uint8Array.from(bytes));
        assert.equal(Buffer.from(item.type.encode(decoded).finish()).toString('hex'), item.reencoded, item.name);
        if (item.name === 'UTF8 non-ASCII') assert.equal(decoded.producerName, 'é🎵');
        if (item.name === 'empty model defaults') assert.equal(Object.hasOwn(decoded, 'irVersion'), false);
        if (item.name === 'explicit zero presence') assert.equal(Object.hasOwn(decoded, 'irVersion'), true);
        if (item.name === 'signed dimension') assert.equal(decoded.value, 'dimValue');
        if (item.name === 'float and negative zero') assert.equal(Object.is(decoded.floatData[1], -0), true);
        literals.push({
            name: item.name,
            representation,
            plain: item.type.toObject(decoded, { longs: String, bytes: Array, oneofs: true }),
        });
    }
}
// Capture exact behavior, including malformed-input errors, for a strict old/new comparison.
// No compatibility exception is asserted in this fixture.
const edgeCases = [
    ['truncated string', onnx.ModelProto, '120361'],
    ['malformed UTF8', onnx.ModelProto, '1201ff'],
    ['ten continuation bytes', onnx.TensorProto, '1080808080808080808080'],
    ['overflowing length', onnx.ModelProto, '128080808010'],
    ['truncated int64', onnx.ModelProto, '0880'],
    ['invalid wire type', onnx.ModelProto, '7f'],
    ['unterminated group', onnx.ModelProto, 'bb060801'],
    ['duplicate oneof value then param', onnx.TensorShapeProto.Dimension, '0801120178'],
    ['duplicate oneof param then value', onnx.TensorShapeProto.Dimension, '1201780801'],
];
const edges = [];
for (const [name, Type, hex] of edgeCases) {
    for (const representation of ['Buffer', 'Uint8Array']) {
        const bytes = Buffer.from(hex, 'hex');
        try {
            const decoded = Type.decode(representation === 'Buffer' ? bytes : Uint8Array.from(bytes));
            edges.push({
                name,
                representation,
                result: Type.toObject(decoded, { longs: String, bytes: Array, oneofs: true }),
                reencoded: Buffer.from(Type.encode(decoded).finish()).toString('hex'),
            });
        } catch (error) {
            edges.push({ name, representation, error: { name: error.name, message: error.message } });
        }
    }
}
assert.throws(() => onnx.TensorProto.fromObject({ dims: 'invalid-array' }), {
    name: 'TypeError',
    message: '.onnx.TensorProto.dims: array expected',
});
assert.equal(onnx.ModelProto.verify({ producerName: 4 }), 'producerName: string expected');
fs.writeFileSync(process.argv[3], JSON.stringify({ valid, literals, edges }, null, 2) + '\n', { flag: 'wx' });
