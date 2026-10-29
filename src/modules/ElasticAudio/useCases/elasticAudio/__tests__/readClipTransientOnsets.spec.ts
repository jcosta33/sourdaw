import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TransientOnsetWorkerRequest } from '../../../models/TransientOnsetWorker';
import { detectTransients } from '../detectTransients';
import { readClipTransientOnsets, readProductTransientOnsets } from '../readClipTransientOnsets';

type Clip = { id: string; type: 'audio' | 'midi'; audioBufferId?: string };
const mocks = vi.hoisted(() => ({
    projectId: 'project-1',
    current: true,
    tracks: [] as {
        id: string;
        clips: Clip[];
        alternatives: { id: string; clips: Clip[] }[];
        activeAlternativeId: string;
    }[],
    cache: vi.fn(),
    worker: vi.fn(),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return { tracks: mocks.tracks };
        },
    },
}));
vi.mock('#/modules/AudioEngine/stores', () => ({ audioBufferCache: { get: mocks.cache } }));
vi.mock('#/modules/Project/stores', () => ({ getSettledProjectId: () => mocks.projectId }));
vi.mock('../../../repositories/transientOnsetWorkerClient', () => ({ runTransientOnsetWorker: mocks.worker }));

function buffer(channels: Float32Array[], sampleRate = 16_000) {
    return {
        length: channels[0]!.length,
        numberOfChannels: channels.length,
        sampleRate,
        getChannelData: vi.fn((channel: number) => channels[channel]!),
    };
}

const request = {
    clipId: 'clip-1',
    sensitivity: 0.5,
    projectId: 'project-1',
    isProjectRevisionCurrent: () => mocks.current,
    maxSourceSeconds: 600,
    maxChannelSamples: 10_000_000,
    timeoutMs: 30_000,
    onAnalysisStarted: vi.fn(),
};

describe('whole cached source transient read', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectId = 'project-1';
        mocks.current = true;
        mocks.tracks = [
            {
                id: 'track-1',
                clips: [{ id: 'clip-1', type: 'audio', audioBufferId: 'private-file-path' }],
                alternatives: [],
                activeAlternativeId: 'active',
            },
        ];
        mocks.worker.mockImplementation(async ({ channels, sampleRate, sensitivity }: TransientOnsetWorkerRequest) => {
            const mono = new Float32Array(channels[0]!.length);
            for (let frame = 0; frame < mono.length; frame++) {
                mono[frame] =
                    channels.reduce((sum: number, channel: Float32Array) => sum + channel[frame]!, 0) / channels.length;
            }
            return { status: 'complete', hits: detectTransients(mono, sampleRate, sensitivity) };
        });
    });

    it.each([1, 2])(
        'copies %i channels, detects the whole source once and exposes only source identity and numerical hits',
        async (count) => {
            const samples = new Float32Array(32_000);
            for (let frame = 4_096; frame < samples.length; frame += 4_096) {
                samples[frame] = 1;
            }
            const channels = Array.from({ length: count }, () => new Float32Array(samples));
            const cached = buffer(channels);
            mocks.cache.mockReturnValue(cached);
            const before = structuredClone(mocks.tracks);
            const result = await readClipTransientOnsets(request);
            expect(result.status).toBe('complete');
            if (result.status !== 'complete') {
                throw new Error(result.code);
            }
            expect(result.hits).toEqual(detectTransients(samples, 16_000, 0.5));
            expect(result.hits.length).toBeGreaterThan(0);
            expect(result.identity).toMatchObject({
                frameCount: 32_000,
                sampleRate: 16_000,
                channelCount: count,
                alternativeId: null,
                activeAlternative: true,
            });
            expect(JSON.stringify(result)).not.toContain('private-file-path');
            expect(mocks.worker).toHaveBeenCalledTimes(1);
            const copied: TransientOnsetWorkerRequest = mocks.worker.mock.calls[0]![0];
            for (let channel = 0; channel < count; channel++) {
                expect(copied.channels[channel]).not.toBe(channels[channel]);
                expect(channels[channel]).toEqual(samples);
            }
            expect(mocks.tracks).toEqual(before);
            expect(result.isCurrent()).toBe(true);
            mocks.cache.mockReturnValue(buffer(channels));
            expect(result.isCurrent()).toBe(false);
        }
    );

    it('resolves an inactive alternative without claiming it is the live comp', async () => {
        mocks.tracks[0]!.alternatives = [{ id: 'take-2', clips: mocks.tracks[0]!.clips }];
        mocks.tracks[0]!.clips = [];
        mocks.cache.mockReturnValue(buffer([new Float32Array(2_048)]));
        expect(await readClipTransientOnsets(request)).toMatchObject({
            status: 'complete',
            identity: {
                alternativeId: 'take-2',
                activeAlternative: false,
            },
        });
    });

    it.each(['shared', 'copied'] as const)(
        'reads the authoritative active projection beside its %s alternative snapshot',
        async (snapshot) => {
            const track = mocks.tracks[0]!;
            track.alternatives = [
                {
                    id: track.activeAlternativeId,
                    clips: snapshot === 'shared' ? track.clips : structuredClone(track.clips),
                },
            ];
            const before = structuredClone(mocks.tracks);
            mocks.cache.mockReturnValue(buffer([new Float32Array(2_048)]));

            const result = await readClipTransientOnsets(request);

            expect(result).toMatchObject({
                status: 'complete',
                identity: { trackId: track.id, alternativeId: track.activeAlternativeId, activeAlternative: true },
            });
            expect(mocks.worker).toHaveBeenCalledTimes(1);
            expect(mocks.tracks).toEqual(before);
        }
    );

    it('reads the live source when the active alternative snapshot still points at older media', async () => {
        const track = mocks.tracks[0]!;
        track.alternatives = [
            { id: track.activeAlternativeId, clips: [{ id: 'clip-1', type: 'audio', audioBufferId: 'stale-media' }] },
        ];
        mocks.cache.mockReturnValue(buffer([new Float32Array(2_048)]));

        expect(await readClipTransientOnsets(request)).toMatchObject({ status: 'complete' });
        expect(mocks.cache.mock.calls.every(([id]) => id === 'private-file-path')).toBe(true);
        expect(mocks.worker).toHaveBeenCalledTimes(1);
    });

    it('refuses a clip present only in the stale active snapshot before touching the audio cache', async () => {
        const track = mocks.tracks[0]!;
        track.alternatives = [{ id: track.activeAlternativeId, clips: [...track.clips] }];
        track.clips = [];
        mocks.cache.mockReturnValue(buffer([new Float32Array(2_048)]));

        expect(await readClipTransientOnsets(request)).toEqual({ status: 'failed', code: 'clip-not-found' });
        expect(mocks.cache).not.toHaveBeenCalled();
        expect(mocks.worker).not.toHaveBeenCalled();
    });

    it.each(['other-track-active', 'other-track-inactive', 'same-track-inactive', 'same-active-collection'] as const)(
        'refuses a genuine %s duplicate even beside the expected active snapshot mirror',
        async (owner) => {
            const track = mocks.tracks[0]!;
            const duplicate = structuredClone(track.clips);
            track.alternatives = [{ id: track.activeAlternativeId, clips: [...track.clips] }];
            if (owner === 'other-track-active') {
                mocks.tracks.push({
                    id: 'track-2',
                    clips: duplicate,
                    alternatives: [],
                    activeAlternativeId: 'other-active',
                });
            }
            if (owner === 'other-track-inactive') {
                mocks.tracks.push({
                    id: 'track-2',
                    clips: [],
                    alternatives: [{ id: 'inactive', clips: duplicate }],
                    activeAlternativeId: 'other-active',
                });
            }
            if (owner === 'same-track-inactive') {
                track.alternatives.push({ id: 'inactive', clips: duplicate });
            }
            if (owner === 'same-active-collection') {
                track.clips.push(...duplicate);
            }

            expect(await readClipTransientOnsets(request)).toEqual({ status: 'failed', code: 'duplicate-clip-id' });
            expect(mocks.cache).not.toHaveBeenCalled();
            expect(mocks.worker).not.toHaveBeenCalled();
        }
    );

    it.each(['missing', 'duplicate', 'midi', 'stale', 'project'] as const)(
        'refuses %s before the audio cache is touched',
        async (reason) => {
            if (reason === 'missing') {
                mocks.tracks = [];
            }
            if (reason === 'duplicate') {
                mocks.tracks[0]!.alternatives = [{ id: 'duplicate', clips: mocks.tracks[0]!.clips }];
            }
            if (reason === 'midi') {
                mocks.tracks[0]!.clips[0]!.type = 'midi';
            }
            if (reason === 'stale') {
                mocks.current = false;
            }
            if (reason === 'project') {
                mocks.projectId = 'other';
            }
            expect(await readClipTransientOnsets(request)).toMatchObject({ status: 'failed' });
            expect(mocks.cache).not.toHaveBeenCalled();
            expect(mocks.worker).not.toHaveBeenCalled();
        }
    );

    it.each([
        { length: 10_000_001, sampleRate: 48_000, numberOfChannels: 1 },
        { length: 2_048, sampleRate: 1, numberOfChannels: 1 },
        { length: 2_048, sampleRate: NaN, numberOfChannels: 1 },
        { length: 2_048, sampleRate: 48_000, numberOfChannels: 0 },
    ])('refuses geometry %j before channel access', async (geometry) => {
        const getChannelData = vi.fn();
        mocks.cache.mockReturnValue({ ...geometry, getChannelData });
        expect(await readClipTransientOnsets(request)).toMatchObject({ status: 'failed' });
        expect(getChannelData).not.toHaveBeenCalled();
        expect(mocks.worker).not.toHaveBeenCalled();
    });

    it('refuses a cache miss without starting analysis', async () => {
        mocks.cache.mockReturnValue(undefined);
        expect(await readClipTransientOnsets(request)).toEqual({ status: 'failed', code: 'missing-buffer' });
        expect(request.onAnalysisStarted).not.toHaveBeenCalled();
    });

    it.each(['revision', 'clip', 'buffer', 'geometry', 'abort'] as const)(
        'checks %s again after the worker completes',
        async (change) => {
            const cached = buffer([new Float32Array(4_096)]);
            mocks.cache.mockReturnValue(cached);
            const controller = new AbortController();
            mocks.worker.mockImplementation(async () => {
                if (change === 'revision') {
                    mocks.current = false;
                }
                if (change === 'clip') {
                    mocks.tracks[0]!.clips = [];
                }
                if (change === 'buffer') {
                    mocks.cache.mockReturnValue(buffer([new Float32Array(4_096)]));
                }
                if (change === 'geometry') {
                    cached.length = 2_048;
                }
                if (change === 'abort') {
                    controller.abort();
                }
                return { status: 'complete', hits: [] };
            });
            expect(await readClipTransientOnsets({ ...request, signal: controller.signal })).toMatchObject({
                status: 'failed',
            });
        }
    );
    it('admits 120-second stereo only through product detection and transfers owned copies', async () => {
        const left = new Float32Array(120 * 48_000);
        const right = new Float32Array(left.length);
        left[1024] = 0.75;
        right[2048] = -0.25;
        mocks.cache.mockReturnValue(buffer([left, right], 48_000));
        const admitted = { ...request, maxChannelSamples: 12_000_000 };
        expect(await readClipTransientOnsets(admitted)).toEqual({ status: 'failed', code: 'source-too-large' });
        expect(mocks.worker).not.toHaveBeenCalled();
        mocks.worker.mockImplementationOnce(async ({ channels }: TransientOnsetWorkerRequest) => {
            const copies = structuredClone(channels, {
                transfer: channels.map((channel) => channel.buffer as ArrayBuffer),
            });
            expect(channels.map((channel) => channel.byteLength)).toEqual([0, 0]);
            expect(copies[0]![1024]).toBe(0.75);
            expect(copies[1]![2048]).toBe(-0.25);
            return { status: 'complete', hits: [{ sampleOffset: 1024, confidence: 1 }] };
        });
        expect(await readProductTransientOnsets(admitted)).toMatchObject({
            status: 'complete',
            hits: [{ sampleOffset: 1024, confidence: 1 }],
        });
        expect(left.byteLength).toBe(120 * 48_000 * 4);
        expect(right.byteLength).toBe(left.byteLength);
        expect(left[1024]).toBe(0.75);
        expect(right[2048]).toBe(-0.25);
    });

    it('stops a product copy before Worker creation when cancelled between chunks', async () => {
        const controller = new AbortController();
        const samples = new Float32Array(600_000);
        mocks.cache.mockReturnValue(buffer([samples], 48_000));
        const read = readProductTransientOnsets({ ...request, signal: controller.signal });
        controller.abort();
        expect(await read).toEqual({ status: 'failed', code: 'cancelled' });
        expect(mocks.worker).not.toHaveBeenCalled();
        expect(samples.byteLength).toBe(600_000 * 4);
    });
});
