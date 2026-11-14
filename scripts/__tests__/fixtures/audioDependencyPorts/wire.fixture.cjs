'use strict';
const assert = require('node:assert/strict');
const vectors = require('./wire-vectors.json');
function wireContract(generated, makeInput = (bytes) => bytes) {
    const { onnx } = generated;
    const observed = [];
    for (const { type, input, wireHex } of vectors.cases) {
        const Type = onnx[type];
        assert.equal(typeof Type.fromObject, 'function');
        const message = Type.fromObject(input);
        assert.equal(Type.verify(message), null);
        assert.equal(Buffer.from(Type.encode(message).finish()).toString('hex'), wireHex);
        // Decode independently frozen bytes, rather than using our own encoder's output.
        const decoded = Type.decode(makeInput(Buffer.from(wireHex, 'hex')));
        const plain = Type.toObject(decoded, { longs: String, bytes: Array });
        assert.deepEqual(plain, input);
        // Default conversion retains real Long signedness and binary byte identity.
        const tensor =
            type === 'TensorProto'
                ? decoded
                : type === 'AttributeProto'
                  ? decoded.t
                  : decoded.graph.node[0].attribute[0].t;
        for (const x of tensor.int64Data) assert.equal(x.unsigned, false);
        for (const x of tensor.uint64Data) assert.equal(x.unsigned, true);
        assert.deepEqual(Array.from(tensor.rawData), [0, 255, 128, 1]);
        const json = Type.toObject(decoded, { longs: String, bytes: String });
        const jsonTensor =
            type === 'TensorProto' ? json : type === 'AttributeProto' ? json.t : json.graph.node[0].attribute[0].t;
        assert.equal(jsonTensor.rawData, 'AP+AAQ==');
        observed.push({ type, wireHex, plain });
    }
    return observed;
}
module.exports = { wireContract };
