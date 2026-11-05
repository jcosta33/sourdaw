import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { captureAudioSourceState, resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTrack, type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { projectTempoAudioSources } from '../../../stores/tempoAudioSources';
import { trackStore } from '../../../stores/trackStore';
import { liveTempoTimeline } from '../../liveTempoTimeline';
import { prepareTempoAudioSources } from '../../prepareTempoAudioSources';
import { slipClipContent } from '../slipClipContent';
import { splitClip } from '../splitClip';
import { trimClipStart } from '../trimClipStart';

/**
 * #5888 makes a split and a tempo edit write canonical source seconds. Once the
 * clip carries them, the schedulers read that entry instead of the beat offset,
 * so a start trim or a content slip has to move the canonical entry itself —
 * the played head is the observable, not the stored beat offset.
 */
const TEMPO = 120;

function seedClip(overrides: Partial<Clip> = {}): Clip {
    const clip = ClipDummy.create({
        id: 'c',
        trackId: 't',
        type: 'audio',
        startBeat: 0,
        endBeat: 8,
        audioOffsetBeats: 0,
        ...overrides,
    });
    trackStore.set({
        tracks: [{ ...createTrack({ id: 't', name: 'Audio', kind: 'audio' }), clips: [clip] }],
        selectedTrackId: 't',
        ghostClips: [],
    });
    return clip;
}

function storedClip(id = 'c'): Clip {
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((row) => row.id === id);
    if (!clip) {
        throw new Error(`Expected clip ${id}`);
    }
    return clip;
}

function playedEntrySeconds(clip: Clip, tempo = TEMPO): number {
    return resolveAudioSourceOffsetSeconds(clip, tempo);
}

describe('canonical audio source window follows start trims and content slips', () => {
    beforeEach(() => {
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, tempo: TEMPO });
        takeLaneStore.set({ lanes: [] });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
    });

    it('moves the played source entry with a split fragment start trim', () => {
        seedClip();
        const rightClipId = splitClip('c', 4);
        expect(rightClipId).not.toBeNull();
        // The split captured the canonical window on both fragments: the left
        // head enters the media at 0 s, the right head at 2 s (beat 4 at 120 BPM).
        expect(storedClip().audioOffsetSeconds).toBe(0);
        expect(playedEntrySeconds(storedClip(rightClipId!))).toBeCloseTo(2, 12);

        expect(trimClipStart('c', 2)).toBe(true);

        const trimmed = storedClip();
        expect(trimmed.startBeat).toBe(2);
        expect(trimmed.audioOffsetBeats).toBe(2);
        // The schedulers resolve the canonical seconds, not audioOffsetBeats:
        // beat 2 is source second 1, so the played entry must advance with it.
        expect(playedEntrySeconds(trimmed)).toBeCloseTo(1, 12);
        expect(
            captureAudioSourceState(trimmed, trimmed.endBeat - trimmed.startBeat, TEMPO)?.audioOffsetSeconds
        ).toBeCloseTo(1, 12);
    });

    it('moves the played source entry with a split fragment content slip', () => {
        seedClip();
        const rightClipId = splitClip('c', 4);
        expect(rightClipId).not.toBeNull();

        expect(slipClipContent('c', 'audio', 2)).toBe(true);

        const slipped = storedClip();
        expect(slipped.startBeat).toBe(0);
        expect(slipped.audioOffsetBeats).toBe(2);
        // A 2-beat slip at 120 BPM re-enters the media at second 1; the window
        // model must translate the canonical head and unwrapped entry together.
        expect(playedEntrySeconds(slipped)).toBeCloseTo(1, 12);
        expect(
            captureAudioSourceState(slipped, slipped.endBeat - slipped.startBeat, TEMPO)?.audioUnwrappedOffsetSeconds
        ).toBeCloseTo(1, 12);
    });

    it('slips an already-advanced fragment from its media entry instead of resetting it', () => {
        seedClip();
        const rightClipId = splitClip('c', 4);
        expect(rightClipId).not.toBeNull();
        expect(playedEntrySeconds(storedClip(rightClipId!))).toBeCloseTo(2, 12);

        expect(slipClipContent(rightClipId!, 'audio', 5)).toBe(true);

        const slipped = storedClip(rightClipId!);
        expect(slipped.audioOffsetBeats).toBe(5);
        // The new content offset names media second 2.5, so the head moves by
        // the 0.5 s between the fragment's captured entry and its new edge.
        expect(playedEntrySeconds(slipped)).toBeCloseTo(2.5, 12);
        expect(slipped.audioUnwrappedOffsetSeconds).toBeCloseTo(2.5, 12);
    });

    it('moves a tempo-promoted entry with a start trim under the edited clock', () => {
        seedClip();
        // The tempo edit's promotion write (`applyTempoAudioSources` projects
        // this same `projectTempoAudioSources` plan) freezes the beat offset as
        // canonical seconds before the new tempo map lands.
        const promotion = prepareTempoAudioSources({ timeline: liveTempoTimeline });
        expect(promotion).not.toBeNull();
        const projected = projectTempoAudioSources(trackStore.value!.tracks, [], promotion!, 'promote');
        expect(projected).not.toBeNull();
        trackStore.set({ ...trackStore.value!, tracks: projected!.tracks });
        expect(storedClip().audioOffsetSeconds).toBe(0);
        expect(storedClip().audioUnwrappedOffsetSeconds).toBe(0);

        transportStore.set({ ...transportStore.value!, tempo: 60 });
        expect(trimClipStart('c', 2)).toBe(true);

        const trimmed = storedClip();
        expect(trimmed.audioOffsetBeats).toBe(2);
        // Two beats trimmed under the edited 60 BPM clock are two source
        // seconds; the trim must advance the promoted entry by that delta.
        expect(playedEntrySeconds(trimmed, 60)).toBeCloseTo(2, 12);
        expect(
            captureAudioSourceState(trimmed, trimmed.endBeat - trimmed.startBeat, 60)?.audioOffsetSeconds
        ).toBeCloseTo(2, 12);
    });

    it('moves a tempo-promoted entry with a content slip under the edited clock', () => {
        seedClip();
        const promotion = prepareTempoAudioSources({ timeline: liveTempoTimeline });
        expect(promotion).not.toBeNull();
        const projected = projectTempoAudioSources(trackStore.value!.tracks, [], promotion!, 'promote');
        expect(projected).not.toBeNull();
        trackStore.set({ ...trackStore.value!, tracks: projected!.tracks });
        expect(storedClip().audioOffsetSeconds).toBe(0);

        transportStore.set({ ...transportStore.value!, tempo: 60 });
        expect(slipClipContent('c', 'audio', 2)).toBe(true);

        const slipped = storedClip();
        expect(slipped.audioOffsetBeats).toBe(2);
        // The slip names two beats of media, which the edited 60 BPM clock
        // converts to two source seconds.
        expect(playedEntrySeconds(slipped, 60)).toBeCloseTo(2, 12);
        expect(slipped.audioUnwrappedOffsetSeconds).toBeCloseTo(2, 12);
    });
});
