import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

import { DELIVERY_PRESETS } from '../../../models/deliveryPresets';
import { resolveDeliveryTargets } from '../../resolveDeliveryTargets';
import { streamExport } from '../streamExport';

afterEach(() => vi.unstubAllGlobals());

describe('multi-target actual output', () => {
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
        vi.stubGlobal('showSaveFilePicker', async () => ({
            createWritable: async () => ({
                write: async (bytes: Uint8Array) => {
                    chunks.push(bytes.slice());
                },
                close,
                abort: async () => {},
            }),
        }));
        const targets = resolveDeliveryTargets({
            targets: [-14, -20].map((lufs, index) => ({
                id: 'target-' + index,
                name: 'Target ' + index,
                settings: {
                    ...DELIVERY_PRESETS[2]!.settings,
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
            const bytes = entries['mix__target-' + index + '.wav']!;
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
        vi.stubGlobal('showSaveFilePicker', async () => ({
            createWritable: async () => ({
                write: async (bytes: Uint8Array) => {
                    chunks.push(bytes.slice());
                },
                close: async () => {},
                abort: async () => {},
            }),
        }));
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
        vi.stubGlobal('showSaveFilePicker', async () => ({
            createWritable: async () => ({
                write: async () => {
                    writes++;
                    await held;
                },
                close: async () => {},
                abort,
            }),
        }));
        const targets = resolveDeliveryTargets({
            targets: [0, 1].map((index) => ({
                id: 'target-' + index,
                name: 'Target',
                settings: { ...DELIVERY_PRESETS[2]!.settings, normalization: 'off' as const },
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
                if (cancelled) throw new Error('Export cancelled');
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
