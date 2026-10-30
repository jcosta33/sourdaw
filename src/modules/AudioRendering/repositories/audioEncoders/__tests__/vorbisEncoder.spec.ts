// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audioBufferToVorbis } from '../vorbisEncoder';

import { joinBytes, oggPages, OggCodecTestWorker, toneSource, useRealOggWorkerTransport } from './oggCodecTestWorker';

beforeEach(useRealOggWorkerTransport);
afterEach(() => vi.unstubAllGlobals());

describe('real bounded Vorbis output', () => {
    it.each([44100, 48000, 88200, 96000])(
        'independently decodes mono/stereo %iHz with level, phase and tail intact',
        async (rate) => {
            type Decoder = {
                initSync: (input: { module: Uint8Array }) => unknown;
                decode_audio_bytes: (bytes: Uint8Array) => {
                    channels: number;
                    sample_rate: number;
                    total_frames: number;
                    decode_warning_count: number;
                    take_samples: () => Float32Array;
                };
            };
            const url = pathToFileURL(resolve('public/wasm/daw-wasm-decoder/daw_wasm_decoder.js'));
            const decoder: Decoder = await import(/* @vite-ignore */ url.href);
            decoder.initSync({ module: await readFile(new URL('daw_wasm_decoder_bg.wasm', url)) });
            for (const channels of [1, 2] as const) {
                const source = toneSource(rate, channels),
                    chunks: Uint8Array[] = [];
                const original = source.pcm.map((channel) => channel.slice());
                await audioBufferToVorbis(source, undefined, {
                    write: async (bytes) => {
                        expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
                        chunks.push(bytes.slice());
                    },
                });
                const bytes = joinBytes(chunks),
                    pages = oggPages(bytes);
                expect(pages.at(-1)!.flags & 4).toBe(4);
                const decoded = decoder.decode_audio_bytes(bytes);
                expect(decoded.decode_warning_count).toBe(0);
                expect(decoded.channels).toBe(channels);
                expect(decoded.sample_rate).toBe(rate);
                expect(decoded.total_frames).toBe(source.length);
                const pcm = decoded.take_samples();
                for (let channel = 0; channel < channels; channel++) {
                    for (const [start, end] of [
                        [128, source.length - 128],
                        [source.length - 1024, source.length - 32],
                    ]) {
                        let reference = 0,
                            actual = 0,
                            projection = 0;
                        for (let frame = start!; frame < end!; frame++) {
                            const a = pcm[frame * channels + channel]!,
                                b = source.pcm[channel]![frame]!;
                            reference += b * b;
                            actual += a * a;
                            projection += a * b;
                        }
                        expect(Math.abs(10 * Math.log10(actual / reference))).toBeLessThanOrEqual(0.5);
                        expect(projection / Math.sqrt(actual * reference)).toBeGreaterThan(0.98);
                    }
                }
                expect(source.pcm).toEqual(original);
            }
            expect(OggCodecTestWorker.instances.every((worker) => worker.terminations === 1)).toBe(true);
        }
    );
});
