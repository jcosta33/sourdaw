import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { kneadStore, defaultKneadState, type KneadClipState } from '../../stores/kneadStore';
import { syncKneadToEngine } from '../syncKneadToEngine';

const { syncKneadState } = vi.hoisted(() => ({ syncKneadState: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { syncKneadState },
}));

function clipState(clipId: string): KneadClipState {
    return {
        clipId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };
}

function trackWithKnead(): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        clips: [{ id: 'clip-1', startBeat: 0, endBeat: 4 }],
        devices: [{ id: 'd1', type: 'Knead' }],
    } as unknown as Track;
}

function setTrack(track: Track | null): void {
    trackStore.set({ tracks: track ? [track] : [], selectedTrackId: null, ghostClips: [] });
}

describe('syncKneadToEngine', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        syncKneadState.mockClear();
        kneadStore.set({ ...defaultKneadState, clips: { 'clip-1': clipState('clip-1') } });
        setTrack(null);
        unsubscribe = syncKneadToEngine();
        // Drain the subscriptions' immediate calls from the set() calls above.
        syncKneadState.mockClear();
    });

    afterEach(() => {
        unsubscribe();
    });

    it('pushes engine state when a Knead device is added via the track store', () => {
        // Adding a Knead device is a trackStore mutation, not a kneadStore one.
        setTrack(trackWithKnead());

        expect(syncKneadState).toHaveBeenCalledTimes(1);
        const [trackId, clips] = syncKneadState.mock.calls[0] as [
            string,
            Record<string, KneadClipState & { startBeat: number; endBeat: number }>,
        ];
        expect(trackId).toBe('track-1');
        expect(clips['clip-1']).toMatchObject({ clipId: 'clip-1', startBeat: 0, endBeat: 4 });
    });

    it('still pushes engine state on a knead store mutation', () => {
        setTrack(trackWithKnead());
        syncKneadState.mockClear();

        kneadStore.set({ ...defaultKneadState, clips: { 'clip-1': clipState('clip-1') } });

        expect(syncKneadState).toHaveBeenCalledWith('track-1', expect.anything());
    });

    it('unsubscribes from both stores so no further engine pushes occur', () => {
        unsubscribe();
        syncKneadState.mockClear();

        setTrack(trackWithKnead());

        expect(syncKneadState).not.toHaveBeenCalled();
    });

    it('does not push to the engine when the knead store has no value', () => {
        kneadStore.set(null);
        syncKneadState.mockClear();

        setTrack(trackWithKnead());

        expect(syncKneadState).not.toHaveBeenCalled();
    });
});
