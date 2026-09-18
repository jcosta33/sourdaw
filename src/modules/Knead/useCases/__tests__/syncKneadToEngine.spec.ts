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

    /**
     * The audio scheduler reads source content from the clip's audio offset,
     * while the Knead worklet picks blobs by subtracting this anchor from song
     * time. Shipping the raw clip start made a slipped clip sound source 1 s
     * while Knead edited source 0 — so the anchor is pulled back by the offset
     * and both sides land on the same source position (issue #3717).
     */
    it('pulls the anchor back by the clip audio offset at the start beat tempo', () => {
        // 120 BPM: 2 offset beats are 1 s of source.
        setTrack({
            ...trackWithKnead(),
            clips: [{ id: 'clip-1', startBeat: 0, endBeat: 4, audioOffsetBeats: 2 }],
        } as unknown as Track);

        // Clip starts at song second 0; the scheduler seeks source second 1.
        expect(lastPushedStartSeconds()).toBeCloseTo(-1, 12);
    });

    it('converts the offset at the flat tempo at the clip start, not the integrated map', () => {
        // Clip starts at beat 12, inside the 60 BPM region: integrated start
        // is 8.0 s. Two offset beats at the *flat* 60 BPM are 2 s — integrating
        // them through the map would count the 120 BPM span they never
        // crossed, the arithmetic the audio projector deliberately avoids.
        tempoMapStore.set({ changes: TEMPO_CHANGES });
        setTrack({
            ...trackWithKnead(),
            clips: [{ id: 'clip-1', startBeat: 12, endBeat: 16, audioOffsetBeats: 2 }],
        } as unknown as Track);

        expect(lastPushedStartSeconds()).toBeCloseTo(6, 12);
    });

    it('moves the anchor the other way for a negative offset pre-roll', () => {
        // -2 beats at 120 BPM: the clip's head sits before its source, the
        // anchor opens by 1 s, and the negative lookup window matches no blob —
        // the span in which nothing sounds.
        setTrack({
            ...trackWithKnead(),
            clips: [{ id: 'clip-1', startBeat: 0, endBeat: 4, audioOffsetBeats: -2 }],
        } as unknown as Track);

        expect(lastPushedStartSeconds()).toBeCloseTo(1, 12);
    });

    it('treats a clip with no audio offset as an unshifted anchor', () => {
        setTrack({
            ...trackWithKnead(),
            clips: [{ id: 'clip-1', startBeat: 2, endBeat: 6 }],
        } as unknown as Track);

        // 2 beats at 120 BPM, no offset: the anchor is the plain clip start.
        expect(lastPushedStartSeconds()).toBeCloseTo(1, 12);
    });
});
