// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audioBufferToOpus } from '../opusEncoder';
import { audioBufferToVorbis } from '../vorbisEncoder';

import { deferred, OggCodecTestWorker, toneSource, useRealOggWorkerTransport } from './oggCodecTestWorker';

beforeEach(useRealOggWorkerTransport);
afterEach(() => vi.unstubAllGlobals());

describe('codec Worker sink acknowledgement and terminal ownership', () => {
    it.each([audioBufferToVorbis, audioBufferToOpus])(
        'holds PCM, progress and EOS behind the first awaited output write',
        async (encode) => {
            const entered = deferred(),
                release = deferred();
            const source = toneSource(48000, 2, 48000 * 3 + 137);
            const original = source.pcm.map((channel) => channel.slice());
            let writes = 0,
                inFlight = 0,
                maximum = 0,
                complete = false;
            const progress = vi.fn();
            const operation = encode(source, progress, {
                write: async (bytes) => {
                    writes++;
                    maximum = Math.max(maximum, ++inFlight);
                    expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
                    if (writes === 1) {
                        entered.resolve();
                        await release.promise;
                    }
                    inFlight--;
                },
            });
            void operation.then(() => {
                complete = true;
            });
            await entered.promise;
            const worker = OggCodecTestWorker.instances[0]!;
            const request = worker.requests.at(-1)!;
            expect(worker.requests.filter((message) => message.kind === 'encode')).toHaveLength(1);
            expect(worker.requests.some((message) => message.kind === 'flush' || message.kind === 'ack')).toBe(false);
            expect(progress).not.toHaveBeenCalled();
            worker.emit({ kind: 'done', session: request.session - 1, id: request.id });
            expect(complete).toBe(false);
            expect(writes).toBe(1);
            release.resolve();
            await operation;
            expect(maximum).toBe(1);
            expect(writes).toBeGreaterThan(1);
            expect(worker.requests.some((message) => message.kind === 'flush')).toBe(true);
            expect(worker.terminations).toBe(1);
            expect(source.pcm).toEqual(original);
        }
    );
    it('does not construct a Worker after an already aborted signal', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            audioBufferToOpus(toneSource(), undefined, { write: async () => {} }, controller.signal)
        ).rejects.toThrow('cancelled');
        expect(OggCodecTestWorker.instances).toHaveLength(0);
    });
    it('settles initialization cancellation and allows an immediate fresh successor', async () => {
        const controller = new AbortController();
        const operation = audioBufferToVorbis(toneSource(), undefined, { write: async () => {} }, controller.signal);
        controller.abort();
        await expect(operation).rejects.toThrow('cancelled');
        await audioBufferToOpus(toneSource(48000, 1, 137), undefined, { write: async () => {} });
        expect(OggCodecTestWorker.instances.map((worker) => worker.terminations)).toEqual([1, 1]);
    });
    it.each(['abort', 'error', 'messageerror', 'sink'] as const)(
        'settles %s during held output once, suppresses late progress and leaves a successor usable',
        async (failure) => {
            const controller = new AbortController(),
                entered = deferred(),
                release = deferred();
            const progress = vi.fn();
            const operation = audioBufferToVorbis(
                toneSource(),
                progress,
                {
                    write: async () => {
                        entered.resolve();
                        await release.promise;
                        if (failure === 'sink') {
                            throw new Error('sink rejected');
                        }
                    },
                },
                controller.signal
            );
            const rejected = expect(operation).rejects.toThrow();
            await entered.promise;
            const worker = OggCodecTestWorker.instances[0]!;
            if (failure === 'abort') {
                controller.abort();
            }
            if (failure === 'error') {
                worker.dispatchEvent(new Event('error'));
            }
            if (failure === 'messageerror') {
                worker.dispatchEvent(new MessageEvent('messageerror'));
            }
            release.resolve();
            await rejected;
            expect(worker.terminations).toBe(1);
            expect(progress).not.toHaveBeenCalled();
            await audioBufferToOpus(toneSource(48000, 2, 137), undefined, { write: async () => {} });
            expect(OggCodecTestWorker.instances.at(-1)!.terminations).toBe(1);
        }
    );
    it('cancels a held real flush before completion, then terminates every repeated session', async () => {
        const entered = deferred(),
            release = deferred(),
            controller = new AbortController();
        const operation = audioBufferToOpus(
            toneSource(48000, 2, 137),
            undefined,
            {
                write: async () => {
                    const worker = OggCodecTestWorker.instances[0]!;
                    if (worker.requests.findLast((request) => request.kind !== 'ack')?.kind === 'flush') {
                        entered.resolve();
                        await release.promise;
                    }
                },
            },
            controller.signal
        );
        const rejection = expect(operation).rejects.toThrow('cancelled');
        await entered.promise;
        controller.abort();
        release.resolve();
        await rejection;
        for (let index = 0; index < 6; index++) {
            await (index % 2 ? audioBufferToVorbis : audioBufferToOpus)(
                toneSource(48000, index % 2 ? 1 : 2, 997),
                undefined,
                { write: async () => {} }
            );
        }
        expect(OggCodecTestWorker.instances.every((worker) => worker.terminations === 1)).toBe(true);
    });
});
