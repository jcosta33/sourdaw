import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PassThrough, Writable, Transform, Readable } from 'node:stream';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
    requireGraph,
    bounded,
    near,
    dft,
    independentWave,
    readWave,
    snapshot,
    storedZip,
    runCli,
} from './scenarios.mjs';
const graph = resolve(process.argv[2]);
const require = requireGraph(graph),
    wav = require('wav'),
    fft = require('fftjs'),
    M = require('meyda'),
    QR = require('qrcode'),
    { PNG } = require('pngjs');
const root = dirname(fileURLToPath(import.meta.url));
const frozen = JSON.parse(await readFile(join(root, 'frozen-pristine.json'), 'utf8'));
let passed = 0,
    failed = 0;
const results = [];
async function check(name, fn) {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
    try {
        await fn();
        passed++;
        console.log(`PASS ${name}`);
        results.push({ name, status: 'passed' });
    } catch (e) {
        failed++;
        console.error(`FAIL ${name}\n${e.stack}`);
        results.push({ name, status: 'failed', error: e.stack });
    }
}
await check('FFT independent impulse sine and seeded real/complex DFT, no input changes', () => {
    for (const { input } of frozen.fft) {
        const saved = input.slice(),
            actual = fft.fft(input),
            expected = dft(input);
        for (const field of ['real', 'imag'])
            for (let k = 0; k < input.length; k++) near(actual[field][k], expected[field][k]);
        const back = fft.ifft(actual);
        for (let k = 0; k < input.length; k++) {
            near(back.real[k], input[k]);
            near(back.imag[k], 0);
        }
        assert.deepEqual(input, saved);
    }
    const input = frozen.complex.input,
        saved = structuredClone(input),
        actual = fft.fft(input),
        expected = dft(input.real, input.imag);
    for (const field of ['real', 'imag'])
        for (let k = 0; k < input.real.length; k++) near(actual[field][k], expected[field][k]);
    assert.deepEqual(input, saved);
    // Official fftjs ifft omits its final conjugation: preserve, disclose, never silently correct DSP.
    const back = fft.ifft(actual);
    for (let k = 0; k < input.real.length; k++) {
        near(back.real[k], input.real[k]);
        near(back.imag[k], -input.imag[k]);
    }
    assert.throws(() => fft.fft([1, 2, 3]), /power of 2/);
    assert.throws(() => fft.fft({ real: [1, 2], imag: [1] }), /same length/);
});
await check('frozen actual FFT Meyda WAV QR outputs without numerical normalization', async () => {
    const current = JSON.parse(JSON.stringify(await snapshot(graph)));
    const expected = structuredClone(frozen);
    for (let i = 0; i < current.waves.length; i++) {
        const old = expected.waves[i].output.events;
        assert.deepEqual(
            old.filter((e) => e !== 'format'),
            ['finish', 'end']
        );
        assert.deepEqual(
            current.waves[i].output.events.filter((e) => e !== 'format'),
            ['end', 'finish']
        );
        expected.waves[i].output.events = current.waves[i].output.events;
    }
    assert.deepEqual(current, expected);
});
await check('Meyda CJS browser UMD and genuine ESM consumer agree on independent impulse', async () => {
    const { createContext, runInContext } = await import('node:vm');
    const build = requireGraph(graph);
    const entry = join(dirname(require.resolve('meyda/package.json')), 'dist/esm/main.js');
    const directory = await mkdtemp(join(tmpdir(), 'meyda-esm-'));
    const bundleFile = join(directory, 'meyda.mjs');
    await build('esbuild').build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: bundleFile,
    });
    const esm = await import(pathToFileURL(bundleFile).href);
    const cjs = M;
    const code = await readFile(join(dirname(require.resolve('meyda/package.json')), 'dist/web/meyda.min.js'), 'utf8');
    const context = createContext({ console, Float32Array, Float64Array, Uint8Array, Uint32Array, ArrayBuffer, Math });
    runInContext(code, context);
    const umd = context.Meyda;
    for (const api of [cjs, esm.default, umd]) {
        const prev = {
            bufferSize: api.bufferSize,
            sampleRate: api.sampleRate,
            windowingFunction: api.windowingFunction,
        };
        Object.assign(api, { bufferSize: 8, sampleRate: 8000, windowingFunction: 'rect' });
        try {
            const out = api.extract(['rms', 'spectralCentroid'], Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]));
            near(out.rms, Math.sqrt(1 / 8));
            near(out.spectralCentroid, 1.5);
        } finally {
            Object.assign(api, prev);
        }
    }
});
await check('WAV independent PCM formats fragmentation truncation malformed and float flag', async () => {
    for (const bits of [8, 16, 24, 32])
        for (const be of [false, true]) {
            const { wave, pcm } = independentWave({ bits, be });
            const result = await readWave(wav, wave);
            assert.equal(result.pcm, pcm.toString('hex'));
            assert.deepEqual(result.errors, []);
            assert.equal(result.format.bitDepth, bits);
            assert.equal(result.format.channels, 2);
            assert.equal(result.format.sampleRate, 8000);
            assert.equal(result.format.endianness, be ? 'BE' : 'LE');
            assert.equal(result.format.blockAlign, (bits / 8) * 2);
        }
    const floating = independentWave({ bits: 32, format: 3 });
    assert.equal((await readWave(wav, floating.wave)).format.float, true);
    const bad = await readWave(wav, Buffer.from('NOPE'));
    assert.deepEqual(bad.errors, ['bad "chunk id": expected "RIFF" or "RIFX", got "NOPE"']);
    assert.equal(bad.pcm, '');
    for (const cut of [3, 20, 43, 46]) {
        const expected = frozen.waves.find((x) => x.cut === cut).output;
        const current = await readWave(wav, independentWave().wave.subarray(0, cut));
        assert.deepEqual(
            current.events.filter((e) => e !== 'format'),
            ['end', 'finish']
        );
        assert.deepEqual({ ...current, events: expected.events }, expected);
    }
});
await check('WAV Writer PCM final header end/finish and FileWriter done bytes', async () => {
    for (const bits of [8, 16, 24, 32]) {
        const { pcm, header, wave } = independentWave({ bits });
        const writer = new wav.Writer({ channels: 2, sampleRate: 8000, bitDepth: bits }),
            chunks = [],
            events = [];
        let final;
        writer.on('data', (c) => chunks.push(c));
        writer.on('header', (h) => {
            events.push('header');
            final = h;
        });
        for (const e of ['end', 'finish', 'close']) writer.on(e, () => events.push(e));
        const ended = once(writer, 'end'),
            finished = once(writer, 'finish');
        writer.write(pcm.subarray(0, 3));
        writer.end(pcm.subarray(3));
        await bounded(Promise.all([ended, finished]), 'WAV Writer');
        assert.deepEqual(Buffer.concat(chunks).subarray(44), pcm);
        assert.deepEqual(final, header);
        assert.equal(events.includes('close'), false);
        assert.equal(events.filter((e) => e === 'header').length, 1);
        const temp = await mkdtemp(join(tmpdir(), 'audio-qr-wav-')),
            file = join(temp, 'pcm.wav'),
            fw = new wav.FileWriter(file, { channels: 2, sampleRate: 8000, bitDepth: bits });
        const fe = [];
        for (const e of ['header', 'finish', 'done']) fw.on(e, () => fe.push(e));
        const done = once(fw, 'done'),
            fileFinished = once(fw.file, 'close');
        await once(fw.file, 'open');
        fw.end(pcm);
        await bounded(Promise.all([done, fileFinished]), 'WAV FileWriter');
        assert.deepEqual(await readFile(file), wave);
        assert.ok(fe.indexOf('done') > fe.indexOf('header'));
    }
});
await check('WAV Writer and Reader slow consumer backpressure callbacks drain and no bytes lost', async () => {
    const pcm = Buffer.alloc(65536);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i % 251;
    for (const kind of ['Writer', 'Reader']) {
        const stream =
            kind === 'Writer'
                ? new wav.Writer({ channels: 2, sampleRate: 8000, bitDepth: 16, highWaterMark: 16 })
                : new wav.Reader({ highWaterMark: 16 });
        const head = independentWave({ frames: pcm.length / 4 }).header,
            bytes = kind === 'Writer' ? pcm : Buffer.concat([head, pcm]);
        let writeDone = false;
        const accepted = stream.write(bytes, () => {
            writeDone = true;
        });
        assert.equal(accepted, false, 'large write must signal pressure');
        assert.equal(writeDone, false, 'callback remains pending while readable output is blocked');
        const output = [],
            sink = new Writable({
                highWaterMark: 17,
                write(c, _e, cb) {
                    output.push(Buffer.from(c));
                    setImmediate(cb);
                },
            });
        const drain = once(stream, 'drain'),
            end = once(stream, 'end'),
            finish = once(sink, 'finish');
        stream.pipe(sink);
        await bounded(drain, 'WAV drain');
        assert.equal(writeDone, true);
        stream.end();
        await bounded(Promise.all([end, finish]), 'WAV slow sink');
        const actual = Buffer.concat(output);
        assert.deepEqual(kind === 'Writer' ? actual.subarray(44) : actual, pcm);
    }
});
await check('stream-parser mixed buffered skip passthrough and async completion paths', async () => {
    const parser = require('stream-parser'),
        p = new Transform({ autoDestroy: false });
    parser(p);
    const chunks = [],
        seen = [];
    p.on('data', (c) => chunks.push(c));
    p._bytes(3, function (c) {
        seen.push(c.toString());
        this._skipBytes(2, function () {
            this._passthrough(4, function () {
                this._bytes(2, function (c, _output, done) {
                    seen.push(c.toString());
                    setImmediate(done);
                });
            });
        });
    });
    const end = once(p, 'end');
    for (const b of ['A', 'BCxy1', '23', '4Z', 'Z']) p.write(Buffer.from(b));
    p.end();
    await bounded(end, 'parser');
    assert.deepEqual(seen, ['ABC', 'ZZ']);
    assert.equal(Buffer.concat(chunks).toString(), '1234');
    const invalid = new Transform({ autoDestroy: false });
    parser(invalid);
    const error = once(invalid, 'error');
    invalid.end(Buffer.from('unexpected'));
    const [reason] = await bounded(error, 'parser invalid state');
    assert.match(reason.message, /not currently parsing/);
});
await check('duplexer2 values EOF error bubbling and slow writable callback preservation', async () => {
    const duplex = require('duplexer2');
    const input = new PassThrough(),
        output = new PassThrough(),
        duplexed = duplex({ highWaterMark: 4 }, input, output),
        sent = [];
    input.on('data', (c) => sent.push(c));
    const incoming = [];
    duplexed.on('data', (c) => incoming.push(c));
    const finish = once(duplexed, 'finish'),
        end = once(duplexed, 'end');
    duplexed.end(Buffer.from('to writable'));
    output.end(Buffer.from('from readable'));
    await bounded(Promise.all([end, finish]), 'duplex');
    assert.equal(Buffer.concat(sent).toString(), 'to writable');
    assert.equal(Buffer.concat(incoming).toString(), 'from readable');
    assert.equal(duplexed.destroyed, false);
    for (const side of ['writable', 'readable']) {
        const w = new PassThrough(),
            r = new PassThrough(),
            d = duplex(w, r);
        const e = once(d, 'error');
        (side === 'writable' ? w : r).emit('error', new Error(`injected ${side}`));
        assert.match((await e)[0].message, new RegExp(side));
    }
    let release;
    const slow = new Writable({
            write(_c, _e, cb) {
                release = cb;
            },
        }),
        source = new PassThrough(),
        d = duplex({ highWaterMark: 2 }, slow, source);
    let called = false;
    assert.equal(
        d.write(Buffer.alloc(16), () => {
            called = true;
        }),
        false
    );
    assert.equal(called, false);
    const drain = once(d, 'drain');
    release();
    await bounded(drain, 'duplex drain');
    assert.equal(called, true);
    d.end();
    source.end();
    d.resume();
    await bounded(once(d, 'end'), 'duplex end');
});
await check('real unzipper ParseOne fragmented independent ZIP slow consumer EOF and missing/error', async () => {
    const unzipper = require('unzipper'),
        payload = Buffer.alloc(65536);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 239;
    const zip = storedZip([
            ['skip.txt', Buffer.from('ignore')],
            ['nested/audio.pcm', payload],
        ]),
        parse = unzipper.ParseOne(/audio\.pcm$/),
        chunks = [];
    const sink = new Writable({
        highWaterMark: 5,
        write(c, _e, cb) {
            chunks.push(Buffer.from(c));
            setImmediate(cb);
        },
    });
    const done = once(sink, 'finish');
    parse.pipe(sink);
    for (let o = 0; o < zip.length; o += 37) parse.write(zip.subarray(o, o + 37));
    parse.end();
    await bounded(done, 'unzip ParseOne');
    assert.deepEqual(Buffer.concat(chunks), payload);
    const missing = unzipper.ParseOne(/absent/),
        failure = once(missing, 'error');
    missing.resume();
    missing.end(zip);
    assert.equal((await bounded(failure, 'missing ZIP entry'))[0].message, 'PATTERN_NOT_FOUND');
    const invalid = unzipper.ParseOne(),
        error = once(invalid, 'error');
    invalid.resume();
    invalid.end(Buffer.from('not a zip file'));
    assert.match((await bounded(error, 'invalid ZIP'))[0].message, /invalid signature/i);
});
await check('real unzipper Extract independent ZIP to disk and slow custom writer close', async () => {
    const unzipper = require('unzipper'),
        directory = await mkdtemp(join(tmpdir(), 'audio-qr-extract-')),
        bytes = Buffer.from('independent archive bytes\0\u00ff'),
        zip = storedZip([['nested/file.bin', bytes]]);
    const extract = unzipper.Extract({ path: directory }),
        done = extract.promise();
    extract.end(zip);
    await bounded(done, 'unzip Extract');
    assert.deepEqual(await readFile(join(directory, 'nested/file.bin')), bytes);
    const received = [],
        slow = unzipper.Extract({
            path: directory,
            getWriter() {
                return new Writable({
                    write(c, _e, cb) {
                        received.push(Buffer.from(c));
                        setImmediate(cb);
                    },
                });
            },
        }),
        finished = slow.promise();
    slow.end(zip);
    await bounded(finished, 'slow Extract close');
    assert.deepEqual(Buffer.concat(received), bytes);
});

await check('actual Meyda CLI WAV parent route preserves frozen and independent features', async () => {
    const { meydaCli } = await import('./meyda-cli.mjs');
    assert.deepEqual(await meydaCli(graph), JSON.parse(await readFile(join(root, 'frozen-meyda-cli.json'), 'utf8')));
});
function assertPixels(
    pixels,
    width,
    height,
    q,
    { margin = 2, scale = 4, dark = [255, 0, 0, 255], light = [0, 0, 0, 0], targetWidth } = {}
) {
    const modules = q.modules.size;
    const s = targetWidth ? targetWidth / (modules + 2 * margin) : scale;
    const expectedSize = Math.floor((modules + 2 * margin) * s);
    assert.equal(width, expectedSize);
    assert.equal(height, width);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const row = Math.floor(y / s - margin),
                col = Math.floor(x / s - margin),
                black = row >= 0 && col >= 0 && row < modules && col < modules && q.modules.get(row, col);
            const at = 4 * (y * width + x);
            assert.deepEqual(Array.from(pixels.subarray(at, at + 4)), black ? dark : light, `pixel ${x},${y}`);
        }
}
const opts = {
    version: 1,
    errorCorrectionLevel: 'H',
    maskPattern: 0,
    margin: 2,
    scale: 4,
    color: { dark: '#ff0000ff', light: '#00000000' },
};
await check('QR frozen matrix framing finder pixels PNG data URL and SVG actual output', async () => {
    const q = QR.create('HELLO', opts);
    assert.equal(q.version, 1);
    assert.equal(q.maskPattern, 0);
    assert.equal(q.errorCorrectionLevel.bit, 2);
    assert.deepEqual(Array.from(q.modules.data), frozen.qr[0].matrix);
    for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++)
            assert.equal(
                Boolean(q.modules.get(y, x)),
                x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4)
            );
    const b = await QR.toBuffer('HELLO', opts),
        png = PNG.sync.read(b);
    assertPixels(png.data, png.width, png.height, q);
    const url = await QR.toDataURL('HELLO', opts);
    assert.deepEqual(PNG.sync.read(Buffer.from(url.split(',')[1], 'base64')).data, png.data);
    assert.match(await QR.toString('HELLO', { ...opts, type: 'svg' }), /<svg/);
    const directory = await mkdtemp(join(tmpdir(), 'audio-qr-'));
    const file = join(directory, 'invite code.png');
    await QR.toFile(file, 'HELLO', opts);
    assert.deepEqual(PNG.sync.read(await readFile(file)).data, png.data);
});
await check('QR actual invite canvas and browser export use frozen bits at product options', async () => {
    const text = frozen.qr[2].text,
        options = { width: 200, margin: 2, color: { dark: '#ffffff', light: '#00000000' } };
    for (const api of [QR, require(join(dirname(require.resolve('qrcode/package.json')), 'lib/browser.js'))]) {
        let image;
        const canvas = {
            width: 0,
            height: 0,
            style: {},
            getContext() {
                return {
                    clearRect() {},
                    createImageData(w, h) {
                        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
                    },
                    putImageData(x) {
                        image = x;
                    },
                };
            },
        };
        await api.toCanvas(canvas, text, options);
        const q = api.create(text, options);
        assert.deepEqual(Array.from(q.modules.data), frozen.qr[2].matrix);
        assertPixels(image.data, canvas.width, canvas.height, q, { targetWidth: 200, dark: [255, 255, 255, 255] });
    }
    await assert.rejects(QR.toBuffer(''), /No input text/);
    await assert.rejects(
        QR.toBuffer('x'.repeat(100), { version: 1, errorCorrectionLevel: 'H' }),
        /cannot contain this amount of data/
    );
});
await check('QR real PNG error callback once and error reaches destination close', async () => {
    const injected = new Error('injected deflate failure');
    let deflaterClose;
    const deflateFactory = () => {
        const deflater = new Transform({
            transform(_c, _e, cb) {
                cb(injected);
            },
        });
        deflaterClose = new Promise((res) => deflater.once('close', res));
        return deflater;
    };
    const options = { ...opts, rendererOpts: { deflateFactory } };
    await assert.rejects(QR.toDataURL('HELLO', options), (e) => e === injected);
    await bounded(deflaterClose, 'failing deflater close');
    let calls = 0;
    await new Promise((res) =>
        QR.toBuffer('HELLO', options, (e) => {
            calls++;
            assert.equal(e, injected);
            res();
        })
    );
    await bounded(deflaterClose, 'buffer deflater close');
    assert.equal(calls, 1);
    const originalError = new Error('PNG error followed by EOF');
    let settles = 0,
        encoderEOF;
    const recoverableFactory = () => {
        const deflater = new Transform({
            transform(c, _e, cb) {
                this.emit('error', originalError);
                cb(null, c);
            },
        });
        encoderEOF = new Promise((res) => deflater.once('end', res));
        return deflater;
    };
    await new Promise((res) =>
        QR.toBuffer('HELLO', { ...opts, rendererOpts: { deflateFactory: recoverableFactory } }, (e) => {
            settles++;
            assert.equal(e, originalError);
            res();
        })
    );
    await bounded(encoderEOF, 'erroring encoder EOF');
    assert.equal(settles, 1, 'PNG error then genuine encoder EOF must settle once');
    const destination = new Writable({
            write(_c, _e, cb) {
                cb();
            },
        }),
        error = once(destination, 'error'),
        close = new Promise((res) => destination.once('close', res));
    QR.toFileStream(destination, 'HELLO', options);
    assert.equal((await error)[0], injected);
    await bounded(close, 'PNG destination close');
    assert.equal(destination.destroyed, true);
});
await check('QR real yargs CLI help invalid choices PNG file stdin SVG Unicode', async () => {
    const help = await runCli(require, ['--help']);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
    const version = await runCli(require, ['--version']);
    assert.equal(version.stdout.trim(), '1.5.4');
    const invalid = await runCli(require, ['--error', 'Z', 'HELLO']);
    assert.notEqual(invalid.code, 0);
    assert.match(invalid.stderr, /Invalid values/);
    const directory = await mkdtemp(join(tmpdir(), 'audio-qr-cli-')),
        file = join(directory, 'with spaces.png');
    const out = await runCli(require, [
        '--error',
        'H',
        '--qzone',
        '2',
        '--scale',
        '4',
        '--mask',
        '0',
        '--output',
        file,
        'HELLO',
    ]);
    assert.equal(out.code, 0, out.stderr);
    const png = PNG.sync.read(await readFile(file));
    assert.equal(png.width, 100);
    const unicode = frozen.qr[1].text,
        svgFile = join(directory, 'Unicode é🎹.svg');
    const svg = await runCli(require, ['--type', 'svg', '--output', svgFile], unicode);
    assert.equal(svg.code, 0, svg.stderr);
    const document = await readFile(svgFile, 'utf8');
    assert.ok(document.startsWith('<?xml version="1.0" encoding="utf-8"?><!DOCTYPE svg PUBLIC'));
    assert.equal(document.slice(document.indexOf('<svg')), await QR.toString(unicode, { type: 'svg' }));
    const text = await runCli(require, [unicode]);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, (await QR.toString(unicode, { type: 'terminal' })) + '\n');
});
console.log(JSON.stringify({ passed, failed, graph }, null, 2));
if (process.env.RESULT)
    await writeFile(process.env.RESULT, JSON.stringify({ passed, failed, graph, results }, null, 2) + '\n');
process.exitCode = failed ? 1 : 0;
