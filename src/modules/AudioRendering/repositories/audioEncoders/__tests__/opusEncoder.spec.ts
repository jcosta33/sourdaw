// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeliveryPcmSource } from '../createDeliveryPcmSource';
import { audioBufferToOpus } from '../opusEncoder';

import { joinBytes, oggPages, OggCodecTestWorker, toneSource, useRealOggWorkerTransport } from './oggCodecTestWorker';

beforeEach(useRealOggWorkerTransport);
afterEach(() => vi.unstubAllGlobals());

describe('real Opus muxer and source preparation', () => {
    it.each([1, 137, 48000 + 113])('flushes exact EOS/granule trimming for %i prepared frames', async (frames) => {
        for (const channels of [1, 2] as const) {
            const source = toneSource(48000, channels, frames),
                chunks: Uint8Array[] = [];
            await audioBufferToOpus(source, undefined, {
                write: async (bytes) => {
                    expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
                    chunks.push(bytes.slice());
                },
            });
            const pages = oggPages(joinBytes(chunks));
            expect(String.fromCharCode(...pages[0]!.body.subarray(0, 8))).toBe('OpusHead');
            const head = new DataView(pages[0]!.body.buffer);
            const preSkip = head.getUint16(10, true);
            expect(head.getUint32(12, true)).toBe(48000);
            expect(pages[0]!.body[9]).toBe(channels);
            expect(pages.at(-1)!.flags & 4).toBe(4);
            expect(pages.at(-1)!.granule - BigInt(preSkip)).toBe(BigInt(frames));
        }
        expect(OggCodecTestWorker.instances.every((worker) => worker.terminations === 1)).toBe(true);
    });
    it.each([44100, 88200, 96000])(
        'prepares %iHz at absolute output positions with partition-invariant phase and tails',
        async (rate) => {
            const original = toneSource(rate, 2, rate + 17);
            const source = createDeliveryPcmSource({ source: original, sampleRate: 48000, channels: 2 });
            const collect = (partition: number) => {
                const output = [new Float32Array(source.length), new Float32Array(source.length)];
                for (let start = 0; start < source.length; start += partition) {
                    const count = Math.min(partition, source.length - start);
                    const channels = source.readChannels!(start, count);
                    for (let channel = 0; channel < 2; channel++) {
                        output[channel]!.set(channels[channel]!, start);
                    }
                }
                return output;
            };
            const normal = collect(4096);
            expect(collect(997)).toEqual(normal);
            expect(collect(1)).toEqual(normal);
            expect(source.length).toBe(Math.round((original.length * 48000) / rate));
            const chunks: Uint8Array[] = [];
            await audioBufferToOpus(source, undefined, {
                write: async (bytes) => {
                    chunks.push(bytes.slice());
                },
            });
            expect(oggPages(joinBytes(chunks)).at(-1)!.flags & 4).toBe(4);
            await expect(audioBufferToOpus(original, undefined, { write: async () => {} })).rejects.toThrow(
                'prepared 48 kHz'
            );
        }
    );
});
