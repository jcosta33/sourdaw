import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAMPLE_RATE = 44100;

const mocks = vi.hoisted(() => ({
    bufferCacheGet: vi.fn(),
    transportValue: { tempo: 120 },
    trackStoreValue: { tracks: [] as Array<{ clips: Array<unknown> }> },
    addWarpMarkerCalls: [] as Array<{ clipId: string; originalBeat: number; options?: unknown }>,
    warpStates: new Map<
        string,
        {
            enabled: boolean;
            markers: Array<{ id: string; originalBeat: number; warpedBeat: number; origin?: string; locked?: boolean }>;
            stretchMode: string;
            originalTempo: number | null;
        }
    >(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
    addWarpMarker: (clipId: string, originalBeat: number, _warpedBeat: number, options?: unknown) => {
        mocks.addWarpMarkerCalls.push({ clipId, originalBeat, options });
        const state = mocks.warpStates.get(clipId) ?? {
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        };
        const opts = (options ?? {}) as { origin?: string; locked?: boolean };
        state.markers.push({
            id: `m-${state.markers.length}`,
            originalBeat,
            warpedBeat: _warpedBeat,
            origin: opts.origin ?? 'user',
            locked: opts.locked ?? false,
        });
        mocks.warpStates.set(clipId, state);
    },
    warpStates: mocks.warpStates,
    getWarpState: (clipId: string) =>
        mocks.warpStates.get(clipId) ?? {
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportValue;
        },
    },
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: (id: string) => mocks.bufferCacheGet(id),
    },
}));

import { detectTransientsForClip } from '../detectTransientsForClip';

function makeBufferWithImpulses(seconds: number, beatPeriodSeconds: number): AudioBuffer {
    const totalSamples = Math.floor(seconds * SAMPLE_RATE);
    const data = new Float32Array(totalSamples);
    const period = Math.floor(beatPeriodSeconds * SAMPLE_RATE);
    for (let i = 0; i < totalSamples; i += period) {
        const burst = Math.floor(0.005 * SAMPLE_RATE);
        for (let j = 0; j < burst && i + j < totalSamples; j++) {
            data[i + j] = (Math.random() * 2 - 1) * Math.exp(-j / 50);
        }
    }
    return {
        length: totalSamples,
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        getChannelData: (_: number) => data,
    } as unknown as AudioBuffer;
}

describe('detectTransientsForClip', () => {
    beforeEach(() => {
        mocks.bufferCacheGet.mockReset();
        mocks.transportValue = { tempo: 120 };
        mocks.trackStoreValue = { tracks: [] };
        mocks.addWarpMarkerCalls.length = 0;
        mocks.warpStates.clear();
    });

    afterEach(() => {
        mocks.warpStates.clear();
    });

    it('returns CLIP_NOT_FOUND when the clip id is unknown', () => {
        const result = detectTransientsForClip('missing', 0.5);
        expect(result).toEqual({ ok: false, reason: 'CLIP_NOT_FOUND' });
    });

    it('returns CLIP_NOT_AUDIO for MIDI clips', () => {
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1', type: 'midi', audioBufferId: undefined }] }],
        };
        const result = detectTransientsForClip('c1', 0.5);
        expect(result).toEqual({ ok: false, reason: 'CLIP_NOT_AUDIO' });
    });

    it('returns NO_BUFFER when the audio buffer is missing', () => {
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1', type: 'audio', audioBufferId: 'b1' }] }],
        };
        mocks.bufferCacheGet.mockReturnValue(undefined);
        const result = detectTransientsForClip('c1', 0.5);
        expect(result).toEqual({ ok: false, reason: 'NO_BUFFER' });
    });

    it('detects transients and writes them to the warp store with origin transient-auto', () => {
        const buffer = makeBufferWithImpulses(1, 0.25);
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1', type: 'audio', audioBufferId: 'b1' }] }],
        };
        mocks.bufferCacheGet.mockReturnValue(buffer);

        const result = detectTransientsForClip('c1', 0.5);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.added).toBeGreaterThanOrEqual(3);
        for (const call of mocks.addWarpMarkerCalls) {
            const opts = call.options as { origin?: string };
            expect(opts.origin).toBe('transient-auto');
        }
    });

    it('preserves user markers across re-detection (replaces only transient-auto markers)', () => {
        const buffer = makeBufferWithImpulses(1, 0.25);
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1', type: 'audio', audioBufferId: 'b1' }] }],
        };
        mocks.bufferCacheGet.mockReturnValue(buffer);
        mocks.warpStates.set('c1', {
            enabled: true,
            markers: [
                { id: 'user1', originalBeat: 1.7, warpedBeat: 1.7, origin: 'user' },
                { id: 'auto1', originalBeat: 0.42, warpedBeat: 0.42, origin: 'transient-auto' },
            ],
            stretchMode: 'complex',
            originalTempo: null,
        });

        const result = detectTransientsForClip('c1', 0.5);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.kept).toBe(1);

        const after = mocks.warpStates.get('c1')!;
        expect(after.markers.some((m) => m.id === 'user1')).toBe(true);
        expect(after.markers.some((m) => m.id === 'auto1')).toBe(false);
        expect(after.markers.some((m) => m.origin === 'transient-auto')).toBe(true);
    });
});
