import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createDeliveryPcmSource } from '../createDeliveryPcmSource';
import { audioBufferToFlac } from '../flacEncoder';
import { audioBufferToMp3 } from '../mp3Encoder';
import { audioBufferToWav } from '../wavEncoder';

/**
 * OE-1 — the same rendered buffer must land at the same level and quantize the
 * same way in every container. These specs compare *decoded sample values*
 * across encoders, not the presence of headers.
 *
 * Determinism comes from the seeded TPDF dither: every encoder draws the same
 * noise sequence for a given seed, so WAV and FLAC must agree bit-for-bit.
 */

const codecMode = vi.hoisted(() => ({ real: false }));

const capturedMp3Blocks: Int16Array[] = [];

vi.mock('@breezystack/lamejs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@breezystack/lamejs')>();
    return {
        Mp3Encoder: vi.fn().mockImplementation(function (channels: number, rate: number, bitrate: number) {
            if (codecMode.real) return new actual.Mp3Encoder(channels, rate, bitrate);
            return {
                encodeBuffer: (left: Int16Array) => {
                    capturedMp3Blocks.push(Int16Array.from(left));
                    return new Uint8Array([1]);
                },
                flush: () => new Uint8Array([2]),
            };
        }),
    };
});

/** A deliberately hot mix: peaks at 1.8 (well over full scale) so per-format
 *  clip-vs-normalize divergence shows up as different sample values. */
function createHotBuffer(channels: number, length: number): AudioBuffer {
    const data = Array.from({ length: channels }, (_unused, ch) => {
        const out = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            out[index] = 1.8 * Math.sin((2 * Math.PI * (index + ch * 7)) / 64);
        }
        return out;
    });
    return {
        numberOfChannels: channels,
        length,
        sampleRate: 44100,
        getChannelData: (ch: number) => data[ch],
    } as unknown as AudioBuffer;
}

/** Read back the interleaved int16 samples a 16-bit WAV actually contains. */
function decodeWav16(arrayBuffer: ArrayBuffer, channels: number, length: number): Int16Array {
    const view = new DataView(arrayBuffer);
    const dataOffset = 12 + 8 + 16 + 8; // RIFF/WAVE + fmt(16) + data header
    const out = new Int16Array(channels * length);
    for (let index = 0; index < out.length; index++) {
        out[index] = view.getInt16(dataOffset + index * 2, true);
    }
    return out;
}

/** STREAMINFO carries an MD5 of the raw interleaved PCM the FLAC stream encodes. */
function readFlacPcmMd5(bytes: Uint8Array): string {
    return Buffer.from(bytes.subarray(26, 42)).toString('hex');
}

/** STREAMINFO bits-per-sample is split across bytes 20 and 21. */
function readFlacBitsPerSample(bytes: Uint8Array): number {
    const high = (bytes[20]! & 0x01) << 4;
    const low = (bytes[21]! >> 4) & 0x0f;
    return (high | low) + 1;
}

function md5Hex(data: Uint8Array): string {
    return createHash('md5').update(data).digest('hex');
}

function peakOf(samples: Int16Array): number {
    let peak = 0;
    for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
}

function rmsOf(samples: Int16Array): number {
    let sum = 0;
    for (const sample of samples) {
        sum += sample * sample;
    }
    return Math.sqrt(sum / samples.length);
}

describe('export format parity (OE-1)', () => {
    beforeEach(() => {
        capturedMp3Blocks.length = 0;
        codecMode.real = false;
    });

    it('should quantize a hot mix to byte-identical 16-bit PCM for WAV and FLAC', async () => {
        const channels = 2;
        const length = 2048;
        const buffer = createHotBuffer(channels, length);
        const dither = { mode: 'tpdf', seed: 7 } as const;

        const wav = await audioBufferToWav(buffer, 16, undefined, dither);
        const flac = await audioBufferToFlac(buffer, 16, undefined, dither);

        const wavSamples = decodeWav16(wav, channels, length);
        const interleaved = new Uint8Array(wavSamples.length * 2);
        const interleavedView = new DataView(interleaved.buffer);
        for (let index = 0; index < wavSamples.length; index++) {
            interleavedView.setInt16(index * 2, wavSamples[index]!, true);
        }

        expect(readFlacPcmMd5(flac)).toBe(md5Hex(interleaved));
    });

    it('should hand MP3 the same 16-bit samples the WAV file contains', async () => {
        const channels = 1;
        const length = 1152;
        const buffer = createHotBuffer(channels, length);
        const dither = { mode: 'tpdf', seed: 11 } as const;

        const wav = await audioBufferToWav(buffer, 16, undefined, dither);
        await audioBufferToMp3(buffer, 128, undefined, dither);

        const wavSamples = decodeWav16(wav, channels, length);
        const mp3Samples = capturedMp3Blocks[0]!;

        expect(Array.from(mp3Samples)).toEqual(Array.from(wavSamples));
        expect(peakOf(mp3Samples)).toBe(peakOf(wavSamples));
        expect(rmsOf(mp3Samples)).toBeCloseTo(rmsOf(wavSamples), 6);
    });

    it('should attenuate an over-full-scale mix instead of hard-clipping it in every format', async () => {
        const channels = 1;
        const length = 1152;
        const buffer = createHotBuffer(channels, length);
        const dither = { mode: 'none' } as const;

        const wav = await audioBufferToWav(buffer, 16, undefined, dither);
        await audioBufferToMp3(buffer, 128, undefined, dither);

        const wavSamples = decodeWav16(wav, channels, length);
        const mp3Samples = capturedMp3Blocks[0]!;

        // A hard-clipped 1.8-peak sine sits at full scale for long runs; a
        // normalized one touches full scale only at the sine crest.
        const wavAtCeiling = Array.from(wavSamples).filter((sample) => Math.abs(sample) >= 0x7fff).length;
        const mp3AtCeiling = Array.from(mp3Samples).filter((sample) => Math.abs(sample) >= 0x7fff).length;

        expect(wavAtCeiling).toBeLessThan(40);
        expect(mp3AtCeiling).toBe(wavAtCeiling);
    });
});

describe('FLAC bit depth (OE-8)', () => {
    it('should emit a 24-bit stream when 24-bit is requested', async () => {
        const buffer = createHotBuffer(2, 512);

        const flac = await audioBufferToFlac(buffer, 24, undefined, { mode: 'none' });

        expect(readFlacBitsPerSample(flac)).toBe(24);
    });

    it('should emit a 16-bit stream when 16-bit is requested', async () => {
        const buffer = createHotBuffer(2, 512);

        const flac = await audioBufferToFlac(buffer, 16, undefined, { mode: 'none' });

        expect(readFlacBitsPerSample(flac)).toBe(16);
    });

    it('should carry 24-bit sample resolution in the STREAMINFO PCM signature', async () => {
        const buffer = createHotBuffer(1, 512);

        const sixteen = await audioBufferToFlac(buffer, 16, undefined, { mode: 'none' });
        const twentyFour = await audioBufferToFlac(buffer, 24, undefined, { mode: 'none' });

        // Same audio, different resolution => different PCM signature.
        expect(readFlacPcmMd5(twentyFour)).not.toBe(readFlacPcmMd5(sixteen));
    });
});

type DecoderModule = {
    initSync: (input: { module: Uint8Array }) => unknown;
    decode_audio_bytes: (bytes: Uint8Array) => {
        readonly channels: number;
        readonly sample_rate: number;
        readonly total_frames: number;
        readonly decode_warning_count: number;
        take_samples: () => Float32Array;
    };
};
async function shippedDecoder(): Promise<DecoderModule> {
    const url = pathToFileURL(resolve(process.cwd(), 'public/wasm/daw-wasm-decoder/daw_wasm_decoder.js'));
    const module: DecoderModule = await import(/* @vite-ignore */ url.href);
    module.initSync({ module: await readFile(new URL('daw_wasm_decoder_bg.wasm', url)) });
    return module;
}
async function captureStream(encode: (write: (bytes: Uint8Array) => Promise<void>) => Promise<void>) {
    const chunks: Uint8Array[] = [];
    await encode(async (bytes) => {
        expect(bytes.length).toBeLessThanOrEqual(65536);
        chunks.push(bytes.slice());
    });
    const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

describe('real streaming codec bytes', () => {
    it('replays seeded 16/24-bit WAV PCM in decoded FLAC, with exact STREAMINFO MD5', async () => {
        const decoder = await shippedDecoder();
        const buffer = createHotBuffer(2, 4096 * 3 + 127);
        for (const depth of [16, 24] as const) {
            const dither = { mode: 'tpdf', seed: 9182 } as const;
            const legacy = await audioBufferToWav(buffer, depth, undefined, dither);
            const wav = await captureStream((write) => audioBufferToWav(buffer, depth, undefined, dither, { write }));
            expect(wav).toEqual(new Uint8Array(legacy));
            const flac = await captureStream((write) => audioBufferToFlac(buffer, depth, undefined, dither, { write }));
            const shape = new DataView(flac.buffer).getBigUint64(18);
            expect(Number(shape & 0xfffffffffn)).toBe(buffer.length);
            expect(readFlacPcmMd5(flac)).toBe(md5Hex(wav.subarray(44)));
            const decodedWav = decoder.decode_audio_bytes(wav);
            const decodedFlac = decoder.decode_audio_bytes(flac);
            expect(decodedFlac.channels).toBe(2);
            expect(decodedFlac.sample_rate).toBe(44100);
            expect(decodedFlac.total_frames).toBe(buffer.length);
            expect(decodedFlac.decode_warning_count).toBe(0);
            expect(decodedFlac.take_samples()).toEqual(decodedWav.take_samples());
        }
    });
    it('decodes real LAME packets at the selected bitrate, channel count, sample rate and audible level', async () => {
        codecMode.real = true;
        try {
            const decoder = await shippedDecoder();
            const buffer = createHotBuffer(2, 44100);
            const bytes = await captureStream((write) =>
                audioBufferToMp3(buffer, 192, undefined, { mode: 'none' }, { write })
            );
            const decoded = decoder.decode_audio_bytes(bytes);
            expect(decoded.channels).toBe(2);
            expect(decoded.sample_rate).toBe(44100);
            expect(Math.abs(decoded.total_frames - buffer.length)).toBeLessThan(2305);
            const samples = decoded.take_samples();
            const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
            expect(rms).toBeGreaterThan(0.6);
            expect(rms).toBeLessThan(0.75);
            // MPEG-1 Layer III bitrate index 11 denotes 192 kbps (not a mocked encoder setting).
            let frame = -1;
            for (let offset = 0; offset < bytes.length - 4; offset++) {
                if (bytes[offset] === 0xff && (bytes[offset + 1]! & 0xfe) === 0xfa) {
                    frame = offset;
                    break;
                }
            }
            expect(frame).toBeGreaterThanOrEqual(0);
            expect(bytes[frame + 2]! >>> 4).toBe(11);
            expect((bytes[frame + 2]! >>> 2) & 3).toBe(0);
        } finally {
            codecMode.real = false;
        }
    });
});

describe('replayable converted real codec bytes', () => {
    it('independently decodes converted mono WAV/FLAC with identical seeded PCM and exact MD5', async () => {
        const decoder = await shippedDecoder();
        const samples = Float32Array.from(
            { length: 48000 },
            (_, frame) => 0.2 * Math.sin((2 * Math.PI * 1000 * frame) / 48000)
        );
        const source = createDeliveryPcmSource({
            source: { length: samples.length, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => samples },
            sampleRate: 44100,
            channels: 1,
        });
        for (const depth of [16, 24] as const) {
            const dither = { mode: 'tpdf' as const, seed: 7821 };
            const wav = await captureStream((write) => audioBufferToWav(source, depth, undefined, dither, { write }));
            const flac = await captureStream((write) => audioBufferToFlac(source, depth, undefined, dither, { write }));
            expect(readFlacPcmMd5(flac)).toBe(createHash('md5').update(wav.subarray(44)).digest('hex'));
            const a = decoder.decode_audio_bytes(wav);
            const b = decoder.decode_audio_bytes(flac);
            for (const output of [a, b]) {
                expect(output.channels).toBe(1);
                expect(output.sample_rate).toBe(44100);
                expect(output.total_frames).toBe(44100);
                expect(output.decode_warning_count).toBe(0);
            }
            const actual = a.take_samples();
            expect(b.take_samples()).toEqual(actual);
            let error = 0;
            for (let frame = 256; frame < 44100 - 256; frame++)
                error += (actual[frame]! - 0.2 * Math.sin((2 * Math.PI * 1000 * frame) / 44100)) ** 2;
            expect(error / (44100 - 512)).toBeLessThan(0.000001);
        }
    });
    it.each([
        [44100, 1],
        [44100, 2],
        [48000, 1],
        [48000, 2],
    ] as const)('decodes factory192kbps MP3 at requested %iHz/%i channels', async (rate, channels) => {
        codecMode.real = true;
        try {
            const decoder = await shippedDecoder();
            const samples = Float32Array.from(
                { length: 96000 },
                (_, frame) => 0.2 * Math.sin((2 * Math.PI * 1000 * frame) / 48000)
            );
            const source = createDeliveryPcmSource({
                source: {
                    length: samples.length,
                    numberOfChannels: 2,
                    sampleRate: 48000,
                    getChannelData: () => samples,
                },
                sampleRate: rate,
                channels,
            });
            const bytes = await captureStream((write) =>
                audioBufferToMp3(source, 192, undefined, { mode: 'none' }, { write })
            );
            const output = decoder.decode_audio_bytes(bytes);
            expect(output.sample_rate).toBe(rate);
            expect(output.channels).toBe(channels);
            expect(output.decode_warning_count).toBe(0);
            expect(Math.abs(output.total_frames - 2 * rate)).toBeLessThanOrEqual(2305);
            const pcm = output.take_samples();
            const rms = Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
            expect(rms).toBeGreaterThan(0.12);
            expect(rms).toBeLessThan(0.16);
        } finally {
            codecMode.real = false;
        }
    });
});
