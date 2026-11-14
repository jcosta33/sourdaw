'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
assert.ok(process.env.PACKAGING_REQUIRE_FROM);
const laneRequire = require('../fixtures/installed-require.cjs').packageRequire;
const publishRequire = createRequire(laneRequire.resolve('electron-publish/package.json'));
const FormData = publishRequire('form-data');
function length(form) {
    return new Promise((resolve, reject) => form.getLength((error, value) => (error ? reject(error) : resolve(value))));
}
function collect(form) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        form.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        form.once('error', reject);
        form.once('end', () => resolve(Buffer.concat(chunks)));
        form.resume();
    });
}
test('real multipart bytes equal computed async file length and retain content type/escaping precedence', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'packaging-form-'));
    try {
        const file = path.join(dir, 'fixture.txt');
        await fsp.writeFile(file, 'ABCDE');
        const form = new FormData();
        form.setBoundary('fixture-boundary');
        form.append('note', 'Ω');
        form.append('file', fs.createReadStream(file, { start: 1, end: 3 }), {
            filename: 'fixture.txt',
        });
        form.append('custom"\r\n', Buffer.from([7, 2, 9]), {
            filename: 'audio.wav',
            contentType: 'audio/fixture',
        });
        const computedLength = await length(form);
        const actual = await collect(form);
        const expected = Buffer.concat([
            Buffer.from('--fixture-boundary\r\nContent-Disposition: form-data; name="note"\r\n\r\nΩ\r\n'),
            Buffer.from(
                '--fixture-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.txt"\r\nContent-Type: text/plain\r\n\r\nBCD\r\n'
            ),
            Buffer.from(
                '--fixture-boundary\r\nContent-Disposition: form-data; name="custom%22%0D%0A"; filename="audio.wav"\r\nContent-Type: audio/fixture\r\n\r\n'
            ),
            Buffer.from([7, 2, 9]),
            Buffer.from('\r\n--fixture-boundary--\r\n'),
        ]);
        assert.deepEqual(actual, expected);
        assert.equal(computedLength, expected.length);
        assert.equal(form.getHeaders()['content-type'], 'multipart/form-data; boundary=fixture-boundary');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});
test('real multipart async length reports unknown stream and filesystem stat failures', async () => {
    const unknown = new FormData();
    unknown.on('error', () => {});
    unknown.append('stream', new PassThrough());
    const error = await new Promise((resolve) => unknown.getLength((error) => resolve(error)));
    assert.equal(error, 'Unknown stream');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'packaging-form-missing-'));
    try {
        const form = new FormData();
        form.on('error', () => {});
        const stream = fs.createReadStream(path.join(dir, 'absent'));
        stream.on('error', () => {});
        form.append('file', stream);
        await assert.rejects(length(form), (error) => error.code === 'ENOENT');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
});
