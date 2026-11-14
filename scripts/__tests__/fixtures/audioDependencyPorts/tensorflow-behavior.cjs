'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vectors = JSON.parse(fs.readFileSync(__dirname + '/hash-vectors.json', 'utf8'));
function hashContract(tf) {
    const { fingerPrint64, hexToLong } = tf.util;
    assert.equal(typeof fingerPrint64, 'function');
    let seed = 10;
    const bytes = Uint8Array.from({ length: 1000 }, () => {
        seed = Number((BigInt(seed) * 16807n) % 2147483647n);
        return (seed >> 1) & 255;
    });
    const result = [];
    for (const { length, hex } of vectors.vectors) {
        const h = fingerPrint64(bytes, length);
        assert.equal(h.toString(16).padStart(16, '0'), hex, 'published Long4 vector at length ' + length);
        assert.equal(h.unsigned, true);
        // Offset/non-owning views must not hash prefix or suffix from backing storage.
        const backing = new Uint8Array(length + 17).fill(0xa7);
        backing.set(bytes.subarray(0, length), 9);
        assert.equal(fingerPrint64(backing.subarray(9, 9 + length)).toString(), h.toString());
        result.push({ length, hex: h.toString(16).padStart(16, '0'), low: h.low, high: h.high, unsigned: h.unsigned });
    }
    // Independent literal from Google Spanner's documented FarmHash Fingerprint64.
    assert.equal(fingerPrint64(new TextEncoder().encode('abc')).toString(), '2640714258260161385');
    const Long = hexToLong('0').constructor;
    const min = Long.fromString('-9223372036854775808', false);
    const max = Long.fromString('9223372036854775807', false);
    const umax = Long.fromString('18446744073709551615', true);
    assert.equal(min.toString(), '-9223372036854775808');
    assert.equal(max.add(1).toString(), min.toString());
    assert.equal(umax.add(1).toString(), '0');
    assert.equal(min.shru(1).toString(), '4611686018427387904');
    assert.equal(umax.mul(umax).toString(), '1');
    for (const edge of vectors.independentUnsignedEdges) {
        const v = Long.fromString(edge.decimal, true);
        assert.equal(v.toString(16).padStart(16, '0'), edge.hex);
        assert.equal(Buffer.from(v.toBytesLE()).toString('hex'), edge.littleEndianHex);
        assert.equal(Long.fromBytes(v.toBytesLE(), true, true).toString(), edge.decimal);
        assert.equal(Long.fromBytes(v.toBytesBE(), true, false).toString(), edge.decimal);
    }
    return result;
}
async function fetchContract(tf) {
    const global = tf.env().global;
    const original = Object.getOwnPropertyDescriptor(global, 'fetch');
    const init = { headers: { 'x-tf-port': 'exact' }, method: 'GET' };
    const requested = [];
    try {
        // Function syntax checks the receiver; arrow stubs would hide unbound calls.
        Object.defineProperty(global, 'fetch', {
            configurable: true,
            writable: true,
            value: function (url, opts) {
                assert.equal(this, global);
                assert.equal(opts, init);
                requested.push(url);
                return Promise.resolve(new Response(Uint8Array.from([0, 255, 17]), { status: 200 }));
            },
        });
        const response = await tf.util.fetch('https://example.invalid/tensor', init);
        assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [0, 255, 17]);
        assert.deepEqual(requested, ['https://example.invalid/tensor']);
        global.fetch = function (url, opts) {
            assert.equal(this, global);
            assert.equal(opts, init);
            return Promise.resolve(new Response('replaced', { status: 202 }));
        };
        const replaced = await tf.util.fetch('https://example.invalid/replaced', init);
        assert.equal(replaced.status, 202);
        assert.equal(await replaced.text(), 'replaced');
        const error = new Error('native fetch transport failure');
        global.fetch = function () {
            return Promise.reject(error);
        };
        await assert.rejects(tf.util.fetch('https://example.invalid/fail'), (value) => value === error);
    } finally {
        if (original) Object.defineProperty(global, 'fetch', original);
        else delete global.fetch;
    }
}
async function dataContract(data, core) {
    const global = core.env().global;
    const original = Object.getOwnPropertyDescriptor(global, 'fetch');
    try {
        Object.defineProperty(global, 'fetch', {
            configurable: true,
            writable: true,
            value: function (url) {
                assert.equal(this, global);
                assert.equal(url, 'https://example.invalid/data');
                return Promise.resolve(new Response(Uint8Array.from([0, 255, 17, 23, 42])));
            },
        });
        const iterator = await new data.URLDataSource('https://example.invalid/data', { chunkSize: 2 }).iterator();
        const chunks = [];
        for (;;) {
            const item = await iterator.next();
            if (item.done) break;
            chunks.push(Array.from(item.value));
        }
        assert.deepEqual(chunks, [[0, 255], [17, 23], [42]]);
    } finally {
        if (original) Object.defineProperty(global, 'fetch', original);
        else delete global.fetch;
    }
}
function missingNativeFetchContract(tf) {
    const global = tf.env().global;
    const original = Object.getOwnPropertyDescriptor(global, 'fetch');
    try {
        delete global.fetch;
        assert.throws(
            () => tf.util.fetch('https://example.invalid/missing'),
            /TensorFlow\.js requires native fetch on Node\.js 26 or Chromium\./
        );
    } finally {
        if (original) Object.defineProperty(global, 'fetch', original);
    }
}
module.exports = { hashContract, fetchContract, dataContract, missingNativeFetchContract };
