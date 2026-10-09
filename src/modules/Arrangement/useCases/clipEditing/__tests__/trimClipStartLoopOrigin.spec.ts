import { beforeEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { trimClipStart } from '#/modules/Arrangement/useCases';

import { setClipLoop } from '../../clipLoop/setClipLoop';

/**
 * #4988 — the loop anchor's write law. A looped clip's start trim advances the
 * content offset (that is the trim working) but must never move the loop
 * anchor: the loop window and the pass count stay anchored to the source. The
 * anchor is stamped when the loop is established — by enabling the loop, or by
 * the first start trim of a clip born looped — and every later trim preserves
 * it. A clip never looped carries no anchor.
 */

function loopedClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-loop',
        trackId: 't-keys',
        name: 'c-loop',
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function plainClip(): Clip {
    return loopedClip({ id: 'c-plain', loopEnabled: undefined, loopLength: undefined });
}

function readClip(clipId: string): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!found) {
        throw new Error(`Expected clip ${clipId} in the track store`);
    }
    return found;
}

// Mirrors createTrack's defaults; the model itself is private to Arrangement.
function midiTrack(clips: Clip[]): Track {
    return {
        id: 't-keys',
        name: 'Keys',
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
        activeAlternativeId: 'alt-keys',
        alternatives: [{ id: 'alt-keys', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

describe('trimClipStart loop anchoring', () => {
    beforeEach(() => {
        trackStore.set({ ...defaultTrackState, tracks: [midiTrack([loopedClip(), plainClip()])] });
    });

    it('stamps the anchor at the placement a born-looped clip is first trimmed from', () => {
        expect(trimClipStart('c-loop', 1)).toBe(true);
        expect(readClip('c-loop').loopOriginBeat).toBe(0);
        expect(readClip('c-loop').startBeat).toBe(1);
    });

    it('preserves the anchor across further trims in both directions', () => {
        trimClipStart('c-loop', 1);
        trimClipStart('c-loop', 3);
        expect(readClip('c-loop').loopOriginBeat).toBe(0);
        trimClipStart('c-loop', 2);
        expect(readClip('c-loop').loopOriginBeat).toBe(0);
        expect(readClip('c-loop').startBeat).toBe(2);
    });

    it('stamps no anchor on a clip that was never looped', () => {
        expect(trimClipStart('c-plain', 2)).toBe(true);
        expect(readClip('c-plain').loopOriginBeat).toBeUndefined();
    });
});

describe('setClipLoop loop anchoring', () => {
    beforeEach(() => {
        trackStore.set({ ...defaultTrackState, tracks: [midiTrack([plainClip()])] });
    });

    it('stamps the anchor where the loop is enabled', () => {
        expect(setClipLoop('c-plain', true)).toBe(true);
        expect(readClip('c-plain').loopEnabled).toBe(true);
        expect(readClip('c-plain').loopOriginBeat).toBe(0);
    });

    it('restamps the anchor when the loop is enabled again later in the arrangement', () => {
        setClipLoop('c-plain', true);
        trimClipStart('c-plain', 6);
        setClipLoop('c-plain', true);
        expect(readClip('c-plain').loopOriginBeat).toBe(6);
    });

    it('leaves the anchor in place while the loop is disabled', () => {
        setClipLoop('c-plain', true);
        setClipLoop('c-plain', false);
        expect(readClip('c-plain').loopEnabled).toBe(false);
        expect(readClip('c-plain').loopOriginBeat).toBe(0);
    });
});
