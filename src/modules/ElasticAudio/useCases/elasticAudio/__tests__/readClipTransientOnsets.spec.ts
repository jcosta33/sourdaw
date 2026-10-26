import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectTransients } from '../detectTransients';
import { readClipTransientOnsets } from '../readClipTransientOnsets';
import { type TransientOnsetWorkerRequest } from '../../../models/TransientOnsetWorker';

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
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: () => mocks.current,
}));
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
    projectRevision: 'revision',
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
            for (let frame = 4_096; frame < samples.length; frame += 4_096) samples[frame] = 1;
            const channels = Array.from({ length: count }, () => new Float32Array(samples));
            const cached = buffer(channels);
            mocks.cache.mockReturnValue(cached);
            const before = structuredClone(mocks.tracks);
            const result = await readClipTransientOnsets(request);
            expect(result.status).toBe('complete');
            if (result.status !== 'complete') throw new Error(result.code);
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

    it.each(['missing', 'duplicate', 'midi', 'stale', 'project'] as const)(
        'refuses %s before the audio cache is touched',
        async (reason) => {
            if (reason === 'missing') mocks.tracks = [];
            if (reason === 'duplicate')
                mocks.tracks[0]!.alternatives = [{ id: 'duplicate', clips: mocks.tracks[0]!.clips }];
            if (reason === 'midi') mocks.tracks[0]!.clips[0]!.type = 'midi';
            if (reason === 'stale') mocks.current = false;
            if (reason === 'project') mocks.projectId = 'other';
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
                if (change === 'revision') mocks.current = false;
                if (change === 'clip') mocks.tracks[0]!.clips = [];
                if (change === 'buffer') mocks.cache.mockReturnValue(buffer([new Float32Array(4_096)]));
                if (change === 'geometry') cached.length = 2_048;
                if (change === 'abort') controller.abort();
                return { status: 'complete', hits: [] };
            });
            expect(await readClipTransientOnsets({ ...request, signal: controller.signal })).toMatchObject({
                status: 'failed',
            });
        }
    );
});
