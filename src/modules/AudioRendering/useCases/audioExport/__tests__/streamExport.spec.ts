// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DELIVERY_PRESETS } from '../../../models/DeliveryPresets';
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
import { resolveDeliveryTargets } from '../../resolveDeliveryTargets';
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

function settings(formats: readonly ('wav' | 'mp3' | 'flac' | 'ogg' | 'opus')[]): Parameters<typeof streamExport>[0] {
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
                if (request.kind !== 'encode') {
                    continue;
                }
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
            if (request.kind === 'encode') {
                expect(request.channels).toEqual(pcm.read(request.channels[0]!.length).channels);
            }
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
            if (controller.signal.aborted) {
                throw new Error('Export cancelled');
            }
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

describe('multi-target actual output', () => {
    it.each(['targets', 'legacy'] as const)(
        'refuses an unshipped format on the %s route before opening storage',
        async (route) => {
            const picker = vi.fn();
            vi.stubGlobal('window', { showSaveFilePicker: picker });
            const formats: ('wav' | 'mp3' | 'flac')[] = ['wav'];
            Reflect.set(formats, '0', 'aac');
            const settings = { formats, bitDepth: 24 as const, mp3BitRate: 192, dither: { mode: 'none' as const } };
            const target = {
                ...DELIVERY_PRESETS[2].settings,
                ...settings,
                id: 'target',
                name: 'Target',
                sampleRate: 48000,
                metadata: undefined,
            };
            const input = {
                destination: {
                    kind: 'browser' as const,
                    suggestedName: 'mix.aac',
                    extension: '.aac',
                    mime: 'audio/aac',
                    archive: false,
                },
                checkCancelled: () => {},
            };
            await expect(
                streamExport(route === 'targets' ? { ...input, targets: [target] } : { ...input, ...settings })
            ).rejects.toThrow('Unsupported delivery format.');
            expect(picker).not.toHaveBeenCalled();
        }
    );
    it('writes distinct same-format targets with real rate/channel/duration conversion and independent gain', async () => {
        const samples = Float32Array.from(
            { length: 96000 },
            (_, frame) => 0.1 * Math.sin((2 * Math.PI * 1000 * frame) / 48000)
        );
        const source = {
            length: samples.length,
            sampleRate: 48000,
            numberOfChannels: 2,
            getChannelData: () => samples,
        };
        const chunks: Uint8Array[] = [];
        const close = vi.fn(async () => {});
        vi.stubGlobal('window', {
            showSaveFilePicker: async () => ({
                createWritable: async () => ({
                    write: async (bytes: Uint8Array) => {
                        chunks.push(bytes.slice());
                    },
                    close,
                    abort: async () => {},
                }),
            }),
        });
        const targets = resolveDeliveryTargets({
            targets: [-14, -20].map((lufs, index) => ({
                id: `target-${index}`,
                name: `Target ${index}`,
                settings: {
                    ...DELIVERY_PRESETS[2].settings,
                    sampleRate: index === 0 ? 48000 : 44100,
                    channels: index === 0 ? (2 as const) : (1 as const),
                    targetLufs: lufs,
                },
                dither: { mode: 'none' as const },
            })),
        });
        const output = await streamExport({
            targets,
            destination: {
                kind: 'browser',
                suggestedName: 'targets.zip',
                extension: '.zip',
                mime: 'application/zip',
                archive: true,
            },
            checkCancelled: () => {},
        });
        await output.writeAudio({ source, name: 'mix', onProgress: () => {}, onLimited: () => {} });
        await output.commit(() => {});
        const zip = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
        let cursor = 0;
        for (const chunk of chunks) {
            zip.set(chunk, cursor);
            cursor += chunk.length;
        }
        const entries = unzipSync(zip);
        expect(Object.keys(entries)).toEqual(['mix__target-0.wav', 'mix__target-1.wav']);
        const peaks: number[] = [];
        for (let index = 0; index < 2; index++) {
            const bytes = entries[`mix__target-${index}.wav`]!;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const channels = index === 0 ? 2 : 1;
            const rate = index === 0 ? 48000 : 44100;
            expect(view.getUint16(22, true)).toBe(channels);
            expect(view.getUint32(24, true)).toBe(rate);
            expect((bytes.length - 44) / (3 * channels)).toBe(2 * rate);
            let peak = 0;
            let sinePower = 0;
            let errorPower = 0;
            for (let frame = 256; frame < 2 * rate - 256; frame++) {
                const offset = 44 + frame * channels * 3;
                const sample =
                    (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) /
                    8388608;
                peak = Math.max(peak, Math.abs(sample));
                const sine = Math.sin((2 * Math.PI * 1000 * frame) / rate);
                sinePower += sample * sine;
            }
            // Project the decoded PCM onto the requested 1kHz tone; a header-only rate
            // substitution leaves a different frequency and fails this actual-sample oracle.
            const amplitude = (sinePower * 2) / (2 * rate - 512);
            for (let frame = 256; frame < 2 * rate - 256; frame++) {
                const offset = 44 + frame * channels * 3;
                const sample =
                    (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) /
                    8388608;
                errorPower += (sample - amplitude * Math.sin((2 * Math.PI * 1000 * frame) / rate)) ** 2;
            }
            expect(errorPower / (2 * rate - 512)).toBeLessThan(amplitude ** 2 * 0.00001);
            peaks.push(peak);
        }
        // Mono has one programme channel instead of two, so its -20 LUFS target needs3dB more
        // per-channel level than the corresponding stereo target at the same loudness.
        expect(20 * Math.log10(peaks[0]! / peaks[1]!)).toBeCloseTo(6 - 10 * Math.log10(2), 1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(samples[7]).toBeCloseTo(0.1 * Math.sin((2 * Math.PI * 1000 * 7) / 48000), 7);
    });
    it('keeps Unicode episode tags in only the actual MP3 entry and independently decodes its payload', async () => {
        const chunks: Uint8Array[] = [];
        vi.stubGlobal('window', {
            showSaveFilePicker: async () => ({
                createWritable: async () => ({
                    write: async (bytes: Uint8Array) => {
                        chunks.push(bytes.slice());
                    },
                    close: async () => {},
                    abort: async () => {},
                }),
            }),
        });
        const targets = resolveDeliveryTargets({
            targets: [
                {
                    id: 'podcast',
                    name: 'Podcast',
                    settings: DELIVERY_PRESETS[3].settings,
                    dither: { mode: 'none' },
                    metadata: { title: 'Épisode 🌊', artist: 'José', description: '音楽' },
                },
                { id: 'game', name: 'Game', settings: DELIVERY_PRESETS[4].settings, dither: { mode: 'none' } },
            ],
        });
        const output = await streamExport({
            targets,
            destination: {
                kind: 'browser',
                archive: true,
                extension: '.zip',
                mime: 'application/zip',
                suggestedName: 'episode.zip',
            },
            checkCancelled: () => {},
        });
        const samples = Float32Array.from(
            { length: 48000 },
            (_, frame) => 0.1 * Math.sin((2 * Math.PI * 1000 * frame) / 48000)
        );
        await output.writeAudio({
            source: { length: samples.length, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => samples },
            name: 'mix',
            onProgress: () => {},
            onLimited: () => {},
        });
        await output.commit(() => {});
        const archive = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
        let offset = 0;
        for (const b of chunks) {
            archive.set(b, offset);
            offset += b.length;
        }
        const files = unzipSync(archive);
        const mp3 = files['mix__podcast.mp3']!;
        expect(new TextDecoder().decode(mp3.subarray(0, 3))).toBe('ID3');
        expect(new TextDecoder().decode(files['mix__game.wav']!.subarray(0, 4))).toBe('RIFF');
        const tags: Record<string, string> = {};
        let cursor = 10;
        const tagLength = ((mp3[6]! << 21) | (mp3[7]! << 14) | (mp3[8]! << 7) | mp3[9]!) + 10;
        while (cursor < tagLength) {
            const id = new TextDecoder().decode(mp3.subarray(cursor, cursor + 4));
            const length =
                (mp3[cursor + 4]! << 21) | (mp3[cursor + 5]! << 14) | (mp3[cursor + 6]! << 7) | mp3[cursor + 7]!;
            const textStart = cursor + 10 + (id === 'COMM' ? 5 : 1);
            tags[id] = new TextDecoder().decode(mp3.subarray(textStart, cursor + 10 + length));
            cursor += 10 + length;
        }
        expect(tags).toMatchObject({ TIT2: 'Épisode 🌊', TPE1: 'José', COMM: '音楽' });
        const url = pathToFileURL(resolve(process.cwd(), 'public/wasm/daw-wasm-decoder/daw_wasm_decoder.js'));
        const decoder: {
            initSync: (input: { module: Uint8Array }) => unknown;
            decode_audio_bytes: (bytes: Uint8Array) => {
                channels: number;
                sample_rate: number;
                total_frames: number;
                decode_warning_count: number;
            };
        } = await import(/* @vite-ignore */ url.href);
        decoder.initSync({ module: await readFile(new URL('daw_wasm_decoder_bg.wasm', url)) });
        const decoded = decoder.decode_audio_bytes(mp3);
        expect(decoded.channels).toBe(2);
        expect(decoded.sample_rate).toBe(44100);
        expect(decoded.decode_warning_count).toBe(0);
        expect(Math.abs(decoded.total_frames - 44100)).toBeLessThanOrEqual(2305);
    });
    it('awaits the real writable before beginning a later target and aborts cancellation', async () => {
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let writes = 0;
        let cancelled = false;
        const abort = vi.fn(async () => {});
        vi.stubGlobal('window', {
            showSaveFilePicker: async () => ({
                createWritable: async () => ({
                    write: async () => {
                        writes++;
                        await held;
                    },
                    close: async () => {},
                    abort,
                }),
            }),
        });
        const targets = resolveDeliveryTargets({
            targets: [0, 1].map((index) => ({
                id: `target-${index}`,
                name: 'Target',
                settings: { ...DELIVERY_PRESETS[2].settings, normalization: 'off' as const },
                dither: { mode: 'none' as const },
            })),
        });
        const output = await streamExport({
            targets,
            destination: {
                kind: 'browser',
                suggestedName: 'two.zip',
                extension: '.zip',
                mime: 'application/zip',
                archive: true,
            },
            checkCancelled: () => {
                if (cancelled) {
                    throw new Error('Export cancelled');
                }
            },
        });
        const samples = new Float32Array(4800);
        const read = vi.fn(() => samples);
        const task = output.writeAudio({
            source: {
                length: 4800,
                numberOfChannels: 2,
                sampleRate: 48000,
                getChannelData: read,
            },
            name: 'mix',
            onProgress: () => {},
            onLimited: () => {},
        });
        await vi.waitFor(() => expect(writes).toBe(1));
        // Two4096-bounded windows x two channels from only the first target.
        // Eagerly preparing the later target would double these actual source reads.
        expect(read).toHaveBeenCalledTimes(4);
        cancelled = true;
        release();
        await expect(task).rejects.toThrow('Export cancelled');
        await output.abort();
        expect(abort).toHaveBeenCalledTimes(1);
    });
});
