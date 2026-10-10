import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { trimClipStart } from '#/modules/Arrangement/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { getSourceOccurrenceOffset } from '../getSourceOccurrenceOffset';

/**
 * The occurrence floor at an exact-multiple trim of a non-dyadic loop (#5198
 * class): a typed loop length whose exact multiple lands on the trim grid
 * leaves the correctly-rounded quotient one ulp below the integer, and the
 * raw floor dropped one occurrence — the first post-trim pass re-rolled a
 * pass that had already sounded. The floor now absorbs the boundary the way
 * the loop window's admission already does: an advance within
 * `CLIP_LOOP_WINDOW_BEAT_TOLERANCE` of the nearest exact multiple counts
 * that many occurrences, only a genuinely sub-floor advance floors.
 *
 * Every case drives the real trim path — `trimClipStart` restamps the loop
 * anchor at the pre-trim start, and the offset is read the way the
 * scheduler's producing line reads it: the anchored advance against the
 * projected loop length.
 */

function loopedClip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'loopLength' | 'endBeat'>): Clip {
    return {
        trackId: 't-probe',
        name: 'c',
        startBeat: 0,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        loopEnabled: true,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function midiTrack(clips: Clip[]): Track {
    return {
        id: 't-probe',
        name: 'Probe',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '',
        clips,
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-probe',
        alternatives: [{ id: 'alt-probe', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function trimLoopedClipAndGetOccurrenceOffset(clip: Clip, trimToBeat: number): number {
    trackStore.set({ ...defaultTrackState, tracks: [midiTrack([{ ...clip, id: clip.id }])] });
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: {
            [clip.id]: [{ id: `${clip.id}-n1`, pitch: 60, startBeat: 0, duration: 0.05, velocity: 100 }],
        },
    });
    expect(trimClipStart(clip.id, trimToBeat)).toBe(true);

    const trimmed = trackStore.value!.tracks[0]!.clips[0]!;
    const advance = trimmed.startBeat - (trimmed.loopOriginBeat ?? trimmed.startBeat);
    expect(advance).toBe(trimToBeat);
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats: trimmed.endBeat - trimmed.startBeat,
        configuredLoopLengthBeats: trimmed.loopLength,
        loopEnabled: trimmed.loopEnabled ?? false,
    });
    return getSourceOccurrenceOffset({
        sourceStartBeat: trimmed.loopOriginBeat!,
        segmentStartBeat: trimmed.startBeat,
        loopLength: loopLengthBeats,
        loopEnabled: true,
    });
}

describe('occurrence floor at an exact-multiple trim of a non-dyadic loop', () => {
    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('loop 1.1 trimmed by 16.5 — exactly 15 loops — counts 15 occurrences', () => {
        // The correctly-rounded quotient sits below the integer…
        expect(16.5 / 1.1).toBeLessThan(15);
        expect(
            trimLoopedClipAndGetOccurrenceOffset(loopedClip({ id: 'c-1', loopLength: 1.1, endBeat: 40 }), 16.5)
        ).toBe(15);
    });

    it('loop 0.17 trimmed by 4.25 — exactly 25 loops — counts 25 occurrences', () => {
        expect(4.25 / 0.17).toBeLessThan(25);
        expect(
            trimLoopedClipAndGetOccurrenceOffset(loopedClip({ id: 'c-2', loopLength: 0.17, endBeat: 12 }), 4.25)
        ).toBe(25);
    });

    it('an advance within tolerance below the exact multiple still counts the full occurrence', () => {
        // 1e-10 below the 15-loop figure: inside `CLIP_LOOP_WINDOW_BEAT_TOLERANCE`.
        expect(
            trimLoopedClipAndGetOccurrenceOffset(loopedClip({ id: 'c-3', loopLength: 1.1, endBeat: 40 }), 16.4999999999)
        ).toBe(15);
    });

    it('a genuinely sub-floor advance beyond tolerance stays at its floor', () => {
        // 1e-7 below the 15-loop figure: three orders past the tolerance, a
        // real sub-multiple trim must not round up to 15.
        expect(
            trimLoopedClipAndGetOccurrenceOffset(loopedClip({ id: 'c-4', loopLength: 1.1, endBeat: 40 }), 16.4999999)
        ).toBe(14);
    });
});
