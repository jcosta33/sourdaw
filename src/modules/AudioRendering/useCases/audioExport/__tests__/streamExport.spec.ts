// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deferred,
    joinBytes,
    OggCodecTestWorker,
    oggPages,
    toneSource,
    useRealOggWorkerTransport,
} from '../../../repositories/audioEncoders/__tests__/oggCodecTestWorker';
import { createDeliveryPcmSource } from '../../../repositories/audioEncoders/createDeliveryPcmSource';
import { readExportPcmBlock } from '../../../repositories/audioEncoders/readExportPcmBlock';
import { streamExport } from '../streamExport';

afterEach(() => vi.unstubAllGlobals());

function browserOutput(holdWrite?: (bytes: Uint8Array) => Promise<void>) {
    const chunks: Uint8Array[] = [];
    const close = vi.fn(async () => {});
    const abort = vi.fn(async () => {});
    const picker = vi.fn(async () => ({
        createWritable: async () => ({
            write: async (bytes: Uint8Array) => {
                await holdWrite?.(bytes);
                chunks.push(bytes.slice());
            },
            close,
            abort,
        }),
    }));
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    return { chunks, close, abort, picker };
}

function settings(formats: Parameters<typeof streamExport>[0]['formats']): Parameters<typeof streamExport>[0] {
    return {
        formats,
        destination: {
            kind: 'browser',
            suggestedName: 'mix.zip',
            extension: '.zip',
            mime: 'application/zip',
            archive: true,
        },
        bitDepth: 24,
        mp3BitRate: 128,
        dither: { mode: 'none' },
        checkCancelled: () => {},
    };
}

async function decoder() {
    const url = pathToFileURL(resolve('public/wasm/daw-wasm-decoder/daw_wasm_decoder.js'));
    const module: {
        initSync: (input: { module: Uint8Array }) => unknown;
        decode_audio_bytes: (bytes: Uint8Array) => {
            channels: number;
            sample_rate: number;
            total_frames: number;
            take_samples: () => Float32Array;
        };
    } = await import(/* @vite-ignore */ url.href);
    module.initSync({ module: await readFile(new URL('daw_wasm_decoder_bg.wasm', url)) });
    return module;
}

describe('global staged browser codecs', () => {
    it.each([44100, 48000, 88200, 96000])(
        'keeps real WAV/Vorbis at %i Hz and feeds Opus direct absolute 48k PCM',
        async (rate) => {
            useRealOggWorkerTransport();
            const source = toneSource(rate, 2, rate + 137);
            const original = source.pcm.map((channel) => channel.slice());
            const sink = browserOutput();
            // Return to the original rate after Opus too: never cascade a converted source.
            const output = await streamExport(settings(['wav', 'opus', 'ogg']));
            await output.writeAudio({ source, name: 'mix', onProgress: () => {}, onLimited: () => {} });
            await output.commit(() => {});
            const entries = unzipSync(joinBytes(sink.chunks));
            expect(Object.keys(entries)).toEqual(['mix.wav', 'mix.opus', 'mix.ogg']);
            const decoded = await decoder();
            for (const format of ['wav', 'ogg']) {
                const actual = decoded.decode_audio_bytes(entries[`mix.${format}`]!);
                expect(actual.sample_rate).toBe(rate);
                expect(actual.channels).toBe(2);
                expect(actual.total_frames).toBe(source.length);
                const pcm = actual.take_samples();
                for (let channel = 0; channel < 2; channel++) {
                    let referenceEnergy = 0,
                        actualEnergy = 0,
                        projection = 0;
                    for (let frame = 256; frame < source.length - 128; frame++) {
                        const reference = original[channel]![frame]!,
                            value = pcm[frame * 2 + channel]!;
                        referenceEnergy += reference * reference;
                        actualEnergy += value * value;
                        projection += reference * value;
                    }
                    expect(Math.abs(10 * Math.log10(actualEnergy / referenceEnergy))).toBeLessThanOrEqual(0.5);
                    expect(projection / Math.sqrt(actualEnergy * referenceEnergy)).toBeGreaterThan(0.98);
                }
            }
            const direct = createDeliveryPcmSource({ source, sampleRate: 48000, channels: 2 });
            let frames = 0;
            const opusWorker = OggCodecTestWorker.instances[0]!;
            for (const request of opusWorker.requests) {
                if (request.kind !== 'encode') continue;
                expect(request.channels).toEqual(
                    readExportPcmBlock({ source: direct, start: frames, length: request.channels[0]!.length })
                );
                frames += request.channels[0]!.length;
            }
            expect(frames).toBe(Math.round((source.length * 48000) / rate));
            const pages = oggPages(entries['mix.opus']!);
            const header = new DataView(pages[0]!.body.buffer);
            expect(header.getUint32(12, true)).toBe(48000);
            expect(pages.at(-1)!.granule - BigInt(header.getUint16(10, true))).toBe(BigInt(frames));
            expect(source.pcm).toEqual(original);
            expect(sink.close).toHaveBeenCalledTimes(1);
            expect(OggCodecTestWorker.instances.map((worker) => worker.terminations)).toEqual([1, 1]);
        }
    );

    it('prepares normalization from actual converted PCM without double gain', async () => {
        useRealOggWorkerTransport();
        const source = toneSource(96000, 2, 96000);
        const sink = browserOutput();
        const { prepareDeliveryTarget } = await import('../prepareDeliveryTarget');
        const expected = await prepareDeliveryTarget({
            source,
            target: { sampleRate: 48000, channels: 2, normalization: 'r128', targetLufs: -20, ceilingDbTp: -1 },
            checkCancelled: () => {},
        });
        const { createPcmBlockReader } = await import('../../../repositories/audioEncoders/createPcmBlockReader');
        const pcm = createPcmBlockReader({ source: expected.source, bitDepth: 32, dither: { mode: 'none' } });
        const output = await streamExport({
            ...settings(['opus']),
            normalization: { targetLufs: -20, ceilingDbTp: -1 },
        });
        await output.writeAudio({ source, name: 'mix', onProgress: () => {}, onLimited: () => {} });
        await output.commit(() => {});
        for (const request of OggCodecTestWorker.instances[0]!.requests) {
            if (request.kind === 'encode')
                expect(request.channels).toEqual(pcm.read(request.channels[0]!.length).channels);
        }
        expect(unzipSync(joinBytes(sink.chunks))['mix.opus']).toBeDefined();
    });

    it('holds the real codec and later format behind a sink write, then cancels without commit', async () => {
        useRealOggWorkerTransport();
        const entered = deferred(),
            release = deferred();
        const sink = browserOutput(async (bytes) => {
            if (String.fromCharCode(...bytes.subarray(0, 4)) === 'OggS') {
                entered.resolve();
                await release.promise;
            }
        });
        const controller = new AbortController();
        const checkCancelled = () => {
            if (controller.signal.aborted) throw new Error('Export cancelled');
        };
        const output = await streamExport({ ...settings(['opus', 'ogg']), signal: controller.signal, checkCancelled });
        // Let ZIP entry headers drain; hold the actual encoded output write.
        const operation = output.writeAudio({
            source: toneSource(),
            name: 'mix',
            onProgress: () => {},
            onLimited: () => {},
        });
        const rejected = expect(operation).rejects.toThrow('cancelled');
        await entered.promise;
        expect(OggCodecTestWorker.instances).toHaveLength(1);
        controller.abort();
        release.resolve();
        await rejected;
        await output.abort();
        expect(sink.close).not.toHaveBeenCalled();
        expect(sink.abort).toHaveBeenCalledTimes(1);
        expect(OggCodecTestWorker.instances[0]!.terminations).toBe(1);
    });
});
