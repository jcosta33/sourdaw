import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip } from '#/modules/Arrangement/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getClipEndLimit } from '../getClipEndLimit';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => { length: number; sampleRate: number } | null>(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

/** One track holding `clip`; the cache holds a 4 s source under `buffer-1`. */
function holdClip(fields: Partial<Clip>): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: 'track-1',
                clips: [
                    ClipDummy.create({
                        id: 'clip-1',
                        trackId: 'track-1',
                        type: 'audio',
                        audioBufferId: 'buffer-1',
                        audioOffsetSeconds: 0,
                        startBeat: 0,
                        endBeat: 2,
                        ...fields,
                    }),
                ],
            }),
        ],
        selectedTrackId: 'track-1',
    });
}

/** At a flat 120 BPM, a clip entering its 4 s source at 0 s runs out on beat 8. */
describe('getClipEndLimit', () => {
    let previousTracks: typeof trackStore.value;
    let previousTransport: typeof transportStore.value;
    let previousTempoMap: typeof tempoMapStore.value;

    beforeEach(() => {
        previousTracks = trackStore.value;
        previousTransport = transportStore.value;
        previousTempoMap = tempoMapStore.value;
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' }] });
        mocks.getCachedAudioBuffer.mockReset();
        mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) =>
            bufferId === 'buffer-1' ? { length: 4 * 48_000, sampleRate: 48_000 } : null
        );
    });

    afterEach(() => {
        trackStore.set(previousTracks);
        transportStore.set(previousTransport);
        tempoMapStore.set(previousTempoMap);
    });

    it('is the beat the live clip source runs out on', () => {
        holdClip({});

        expect(getClipEndLimit('clip-1')).toBeCloseTo(8, 9);
    });

    it('is the clip end itself when the clip already runs past its source', () => {
        holdClip({ endBeat: 10 });

        expect(getClipEndLimit('clip-1')).toBe(10);
    });

    it.each<[string, Partial<Clip>]>([
        ['a looping clip', { loopEnabled: true }],
        ['a clip whose source is not cached', { audioBufferId: 'buffer-uncached' }],
        ['a MIDI clip', { type: 'midi', audioBufferId: undefined }],
    ])('is unlimited for %s', (_case, fields) => {
        holdClip(fields);

        expect(getClipEndLimit('clip-1')).toBeNull();
    });

    it('is unlimited for a clip no track holds', () => {
        holdClip({});

        expect(getClipEndLimit('clip-gone')).toBeNull();
    });
});
