import { beforeEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { trimClipStart } from '#/modules/Arrangement/useCases';
import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';

import { handleTrimClipStart } from '../../../handlers/clip/handleTrimClipStart';
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

    it('mints no anchor when a legacy undo entry replays the pre-trim start (#5198)', () => {
        // A pre-anchor build left this born-looped clip trimmed to 4 and
        // anchorless; its recorded inverse replays `trimClipStart(clipId, 0)`.
        // Minting at the pre-restore start would derive advance 0 - 4 = -4,
        // a window whose floor sits 4 beats above the head and silences the
        // restored head. A replayed entry must stay anchorless: advance zero,
        // the window opening at the head.
        trackStore.set({
            ...defaultTrackState,
            tracks: [midiTrack([loopedClip({ id: 'c-legacy', startBeat: 4, endBeat: 16 })])],
        });

        expect(trimClipStart('c-legacy', 0)).toBe(true);

        const restored = readClip('c-legacy');
        expect(restored.startBeat).toBe(0);
        expect(Object.hasOwn(restored, 'loopOriginBeat')).toBe(false);
        expect(
            resolveClipLoopOriginAdvance({
                startBeat: restored.startBeat,
                loopOriginBeat: restored.loopOriginBeat,
                loopEnabled: restored.loopEnabled === true,
            })
        ).toBe(0);
    });

    it('mints no anchor when a born-looped clip is first extended leftward', () => {
        // The same guard: a first start move that does not advance the head —
        // a fresh extension leftward — keeps the pre-anchor reading instead of
        // stamping a negative advance that silences the extension.
        trackStore.set({
            ...defaultTrackState,
            tracks: [midiTrack([loopedClip({ id: 'c-extend', startBeat: 4, endBeat: 16 })])],
        });

        expect(trimClipStart('c-extend', 2)).toBe(true);

        const extended = readClip('c-extend');
        expect(extended.startBeat).toBe(2);
        expect(Object.hasOwn(extended, 'loopOriginBeat')).toBe(false);
    });

    it('restores no anchor when the undo of a leftward extension replays rightward (#5198)', () => {
        // A born-looped anchorless clip extended left to 2; its recorded
        // inverse carries the pre-action start 4 AND the pre-action anchor
        // state — none. The replay moves rightward, so the old mint guard
        // passed and minted at the extension start: anchor 2 under start 4
        // derives advance 2, a window whose ceiling silences the loop's
        // second half — material that sounded before the extension. The
        // exact-anchor leg keeps the restored clip anchorless: advance zero,
        // the pre-extension reading.
        trackStore.set({
            ...defaultTrackState,
            tracks: [midiTrack([loopedClip({ id: 'c-ext', startBeat: 4, endBeat: 16 })])],
        });
        const action = { type: 'trimClipStart', payload: { clipId: 'c-ext', newStartBeat: 2 } } as const;
        const description = handleTrimClipStart.describe(action);
        expect(handleTrimClipStart.execute(action)).toEqual({ status: 'written' });

        if (description.inverseAction?.type !== 'trimClipStart') {
            throw new Error('Expected trim inverse action');
        }
        // The inverse carries the pre-action anchor state: the clip had none.
        expect(description.inverseAction.payload.loopOriginBeat).toBeNull();
        expect(handleTrimClipStart.execute(description.inverseAction)).toEqual({ status: 'written' });

        const restored = readClip('c-ext');
        expect(restored.startBeat).toBe(4);
        expect(Object.hasOwn(restored, 'loopOriginBeat')).toBe(false);
        expect(
            resolveClipLoopOriginAdvance({
                startBeat: restored.startBeat,
                loopOriginBeat: restored.loopOriginBeat,
                loopEnabled: restored.loopEnabled === true,
            })
        ).toBe(0);
    });

    it('restores the captured anchor when an anchored trim inverse replays in either direction', () => {
        // An anchored clip's trim-undo keeps its anchor exactly: the inverse
        // records the value it captured, and the replay writes it back rather
        // than re-deriving it. The second trim's undo replays RIGHTWARD — the
        // direction the old guard left to the keep-law — so the recorded
        // value, not the replay direction, decides the restored anchor.
        trackStore.set({ ...defaultTrackState, tracks: [midiTrack([loopedClip({ id: 'c-anchored' })])] });
        expect(trimClipStart('c-anchored', 6)).toBe(true);
        expect(readClip('c-anchored').loopOriginBeat).toBe(0);

        const secondTrim = { type: 'trimClipStart', payload: { clipId: 'c-anchored', newStartBeat: 2 } } as const;
        const description = handleTrimClipStart.describe(secondTrim);
        expect(handleTrimClipStart.execute(secondTrim)).toEqual({ status: 'written' });
        if (description.inverseAction?.type !== 'trimClipStart') {
            throw new Error('Expected trim inverse action');
        }
        // The inverse captures the anchored pre-action state.
        expect(description.inverseAction.payload.newStartBeat).toBe(6);
        expect(description.inverseAction.payload.loopOriginBeat).toBe(0);
        expect(handleTrimClipStart.execute(description.inverseAction)).toEqual({ status: 'written' });

        const restored = readClip('c-anchored');
        expect(restored.startBeat).toBe(6);
        expect(restored.loopOriginBeat).toBe(0);
    });

    it('replays a legacy extension inverse with the mint the fieldless payload always produced', () => {
        // An entry recorded before the inverse carried an anchor decodes
        // without the field and replays the mint law it always did: the
        // rightward replay of a pre-anchor extension entry still mints at the
        // pre-action start. The field's absence is the legacy behavior, kept.
        trackStore.set({
            ...defaultTrackState,
            tracks: [midiTrack([loopedClip({ id: 'c-legacy-ext', startBeat: 2, endBeat: 16 })])],
        });

        expect(trimClipStart('c-legacy-ext', 4)).toBe(true);

        const replayed = readClip('c-legacy-ext');
        expect(replayed.startBeat).toBe(4);
        expect(replayed.loopOriginBeat).toBe(2);
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
