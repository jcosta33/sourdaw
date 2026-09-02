import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

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

function trackWithKnead(startBeat = 0): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        clips: [{ id: 'clip-1', startBeat, endBeat: startBeat + 4 }],
        devices: [{ id: 'd1', type: 'Knead' }],
    } as unknown as Track;
}

/**
 * 120 BPM until beat 8, then 60 BPM. Beat 12 is 4 s + 4 s = 8.0 s in — neither
 * of the two flat readings the map replaces (6.0 s at 120, 12.0 s at 60).
 */
const TEMPO_CHANGES = [
    { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' as const },
    { id: 'tempo-b', beat: 8, tempo: 60, curve: 'instant' as const },
];

function lastPushedStartSeconds(): number {
    const call = syncKneadState.mock.calls.at(-1) as [string, Record<string, { startSeconds: number }>] | undefined;
    if (!call) {
        throw new Error('nothing was pushed to the engine');
    }
    const clip = call[1]['clip-1'];
    if (!clip) {
        throw new Error('the pushed payload carries no clip-1');
    }
    return clip.startSeconds;
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
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
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

    /**
     * The engine's Knead worklet picks a pitch blob by clip time in seconds and
     * cannot integrate a tempo map — it has no map. The clip's start beat is
     * therefore converted here, where the map lives.
     */
    it('publishes the clip start integrated through the tempo map', () => {
        tempoMapStore.set({ changes: TEMPO_CHANGES });
        syncKneadState.mockClear();

        setTrack(trackWithKnead(12));

        // 8 beats at 120 BPM then 4 at 60: 4 s + 4 s. The flat readings the
        // anchor replaces are 6 s (120 BPM throughout) and 12 s (60 throughout).
        expect(lastPushedStartSeconds()).toBeCloseTo(8, 12);
    });

    /**
     * A tempo edit moves every clip's anchor while touching neither the knead
     * store nor the track store. Without this subscription the engine keeps
     * correcting against the seconds the clip used to start at.
     */
    it('re-pushes the clip anchor when the tempo map changes', () => {
        setTrack(trackWithKnead(12));
        syncKneadState.mockClear();

        tempoMapStore.set({ changes: TEMPO_CHANGES });

        expect(syncKneadState).toHaveBeenCalled();
        expect(lastPushedStartSeconds()).toBeCloseTo(8, 12);
    });

    /**
     * With no tempo map the base tempo is the whole map, and `setTempo` writes
     * it straight to the transport store.
     */
    it('re-pushes the clip anchor when the base tempo changes with no tempo map', () => {
        setTrack(trackWithKnead(12));
        syncKneadState.mockClear();

        transportStore.set({ ...defaultTransportState, tempo: 60 });

        expect(syncKneadState).toHaveBeenCalled();
        // 12 beats at 60 BPM, where 120 BPM read 6.
        expect(lastPushedStartSeconds()).toBeCloseTo(12, 12);
    });

    /**
     * The transport store also carries the playhead and the transport flags,
     * none of which move an anchor. Re-sending every blob on each of those
     * would put the whole payload on the port on every play and stop.
     */
    it('ignores a transport write that leaves the base tempo alone', () => {
        setTrack(trackWithKnead(12));
        syncKneadState.mockClear();

        transportStore.set({ ...defaultTransportState, isPlaying: true, playheadPosition: 3 });

        expect(syncKneadState).not.toHaveBeenCalled();
    });

    it('does not push to the engine when the knead store has no value', () => {
        kneadStore.set(null);
        syncKneadState.mockClear();

        setTrack(trackWithKnead());

        expect(syncKneadState).not.toHaveBeenCalled();
    });
});
