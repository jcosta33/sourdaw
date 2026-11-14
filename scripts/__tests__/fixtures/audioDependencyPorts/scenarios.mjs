import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Transform, Writable, PassThrough, Readable } from 'node:stream';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
export { requireGraph } from '../../../dependencyPorts/installed.mjs';
import { requireGraph } from '../../../dependencyPorts/installed.mjs';
export const bounded = (promise, label) => {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`No ${label} completion within 5s`)), 5000);
        }),
    ]).finally(() => clearTimeout(timer));
};
export const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
export function dft(real, imag = real.map(() => 0)) {
    const N = real.length;
    return {
        real: real.map((_, k) =>
            real.reduce(
                (s, x, n) =>
                    s + x * Math.cos((2 * Math.PI * k * n) / N) + imag[n] * Math.sin((2 * Math.PI * k * n) / N),
                0
            )
        ),
        imag: real.map((_, k) =>
            real.reduce(
                (s, x, n) =>
                    s + imag[n] * Math.cos((2 * Math.PI * k * n) / N) - x * Math.sin((2 * Math.PI * k * n) / N),
                0
            )
        ),
    };
}
export function independentWave({ bits = 16, channels = 2, rate = 8000, be = false, format = 1, frames = 4 } = {}) {
    const bytes = bits / 8,
        pcm = Buffer.alloc(bytes * channels * frames);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 37 + 11) % 256;
    const h = Buffer.alloc(44);
    h.write(be ? 'RIFX' : 'RIFF');
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.write('data', 36);
    const u16 = (n, o) => h[be ? 'writeUInt16BE' : 'writeUInt16LE'](n, o),
        u32 = (n, o) => h[be ? 'writeUInt32BE' : 'writeUInt32LE'](n, o);
    u32(36 + pcm.length, 4);
    u32(16, 16);
    u16(format, 20);
    u16(channels, 22);
    u32(rate, 24);
    u32(rate * channels * bytes, 28);
    u16(channels * bytes, 32);
    u16(bits, 34);
    u32(pcm.length, 40);
    return { pcm, header: h, wave: Buffer.concat([h, pcm]) };
}
export async function readWave(wav, input, parts = [1, 2, 3, 5, 8, 13, 21]) {
    const reader = new wav.Reader();
    const chunks = [],
        errors = [],
        events = [];
    let format;
    for (const e of ['end', 'finish', 'close']) reader.on(e, () => events.push(e));
    reader.on('error', (e) => errors.push(e.message));
    reader.on('format', (f) => {
        format = f;
        events.push('format');
    });
    reader.on('data', (c) => chunks.push(c));
    const end = new Promise((res) => reader.once('end', res));
    const finish = new Promise((res) => reader.once('finish', res));
    for (let off = 0, i = 0; off < input.length; i++) {
        const len = parts[i % parts.length];
        reader.write(input.subarray(off, off + len));
        off += len;
    }
    reader.end();
    await bounded(Promise.all([end, finish]), 'WAV reader');
    assert.equal(events.includes('close'), false, 'natural reader completion must not auto-destroy');
    return { format: format ?? null, pcm: Buffer.concat(chunks).toString('hex'), errors, events };
}
export function extractSnapshot(M) {
    const result = [];
    const original = { bufferSize: M.bufferSize, sampleRate: M.sampleRate, windowingFunction: M.windowingFunction };
    try {
        for (const rate of [44100, 48000])
            for (const window of ['rect', 'hanning']) {
                const n = 1024;
                Object.assign(M, { bufferSize: n, sampleRate: rate, windowingFunction: window });
                const data = Float32Array.from(
                    { length: n },
                    (_, i) =>
                        0.5 * Math.sin((2 * Math.PI * 440 * i) / rate) +
                        0.125 * Math.cos((2 * Math.PI * 1000 * i) / rate)
                );
                const before = data.slice();
                const features = M.extract(
                    ['rms', 'spectralCentroid', 'chroma', 'mfcc', 'amplitudeSpectrum', 'zcr'],
                    data
                );
                assert.deepEqual(data, before);
                result.push({ rate, window, features: JSON.parse(JSON.stringify(features)) });
            }
    } finally {
        Object.assign(M, original);
    }
    return result;
}
export function qrSnapshot(QR) {
    return [
        { text: 'HELLO', opts: { version: 1, errorCorrectionLevel: 'H', maskPattern: 0 } },
        { text: 'sourdaw://join/é🎹?room=123', opts: { errorCorrectionLevel: 'M' } },
        { text: 'https://sourdaw.com/?join=room_123&peer=J%C3%B3s%C3%A9', opts: {} },
    ].map(({ text, opts }) => {
        const q = QR.create(text, opts);
        return {
            text,
            opts,
            size: q.modules.size,
            version: q.version,
            mask: q.maskPattern,
            ecl: q.errorCorrectionLevel.bit,
            matrix: Array.from(q.modules.data),
        };
    });
}
export function storedZip(entries) {
    // Independent ZIP writer (store method), not a zip-library round trip.
    const crc = (b) => {
        let n = 0xffffffff;
        for (const v of b) {
            n ^= v;
            for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
        }
        return (n ^ 0xffffffff) >>> 0;
    };
    const locals = [],
        centrals = [];
    let offset = 0;
    for (const [name, data] of entries) {
        const n = Buffer.from(name),
            h = Buffer.alloc(30),
            c = Buffer.alloc(46);
        h.writeUInt32LE(0x04034b50);
        h.writeUInt16LE(20, 4);
        h.writeUInt32LE(crc(data), 14);
        h.writeUInt32LE(data.length, 18);
        h.writeUInt32LE(data.length, 22);
        h.writeUInt16LE(n.length, 26);
        c.writeUInt32LE(0x02014b50);
        c.writeUInt16LE(20, 4);
        c.writeUInt16LE(20, 6);
        c.writeUInt32LE(crc(data), 16);
        c.writeUInt32LE(data.length, 20);
        c.writeUInt32LE(data.length, 24);
        c.writeUInt16LE(n.length, 28);
        c.writeUInt32LE(offset, 42);
        locals.push(h, n, data);
        centrals.push(c, n);
        offset += h.length + n.length + data.length;
    }
    const central = Buffer.concat(centrals),
        end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, central, end]);
}
export async function runCli(require, args, input = '') {
    const p = spawn(process.execPath, [join(dirname(require.resolve('qrcode/package.json')), 'bin/qrcode'), ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
        stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    const done = once(p, 'close');
    p.stdin.end(input);
    const [code] = await bounded(done, 'QR CLI');
    return { code, stdout, stderr };
}
export async function snapshot(graph) {
    const require = requireGraph(graph),
        wav = require('wav'),
        fft = require('fftjs'),
        q = require('qrcode');
    const signals = [
        [1, 0, 0, 0, 0, 0, 0, 0],
        Array.from({ length: 8 }, (_, i) => Math.sin((2 * Math.PI * i) / 8)),
        Array.from({ length: 16 }, (_, i) => ((i * 977 + 71) % 4093) / 2048 - 1),
    ];
    const complex = { real: [1, 0.5, -2, 0, 0.3, 0.8, 1, -0.2], imag: [0.25, -1, 0, 0.8, 0.4, 0, -0.7, 1] };
    const waves = [];
    for (const bits of [8, 16, 24, 32])
        for (const be of [false, true]) {
            const v = independentWave({ bits, be });
            waves.push({ bits, be, output: await readWave(wav, v.wave) });
        }
    for (const cut of [3, 20, 43, 46]) {
        const v = independentWave();
        waves.push({ cut, output: await readWave(wav, v.wave.subarray(0, cut)) });
    }
    return {
        fft: signals.map((s) => ({ input: s, fft: fft.fft(s), inverse: fft.ifft(fft.fft(s)) })),
        complex: { input: complex, fft: fft.fft(complex), inverse: fft.ifft(fft.fft(complex)) },
        meyda: extractSnapshot(require('meyda')),
        waves,
        qr: qrSnapshot(q),
    };
}
