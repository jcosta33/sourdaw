import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, type TakeLaneStoreState, takeLaneStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { selectMidiNotesForLoopWindow } from '../selectMidiNotesForLoopWindow';

type ScheduledMidiNote = Parameters<typeof selectMidiNotesForLoopWindow>[0]['notes'][number];

/**
 * #4988, comped MIDI takes under an anchored looped source: the take fragment
 * the live resolver stamps inherits the comp region's overlap start as its
 * `startBeat`, so a carried loop anchor would derive a large spurious advance
 * (regionStart − anchor) and shift the admission window off the material the
 * take holds. The resolvers strip the anchor, so the window reads the
 * pre-anchor law against the fragment's own offset — the same notes it
 * admitted before anchoring existed.
 *
 * Figures: a 16-beat MIDI recording looped at 4 from anchor 0; pass 3 holds
 * media beats [8,12), and the comp region [8,12) is one full loop past the
 * anchor. The fragment enters its take at midiOffsetBeats 16, so the region
 * head admits the phase-0 notes — including pass 3's own first note, note-8.
 */

function midiSource(loopOriginBeat: number | undefined): Clip {
    const clip: Clip = {
        id: 'rec-m',
        trackId: 't1',
        name: 'Loop recording',
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        loopEnabled: true,
        loopLength: 4,
        midiOffsetBeats: 0,
    };
    if (loopOriginBeat !== undefined) {
        clip.loopOriginBeat = loopOriginBeat;
    }
    return clip;
}

/** A MIDI loop pass as the recorder stages it: media depth only. */
function midiPassTake(id: string, startBeat: number, depthBeats: number) {
    return {
        id,
        clipId: 'rec-m',
        name: id,
        startBeat,
        endBeat: startBeat + 4,
        selected: false,
        sourceOffsetBeats: depthBeats,
    };
}

const PASS3_LANE: TakeLaneStoreState = {
    lanes: [
        {
            id: 'lane-1',
            trackId: 't1',
            takes: [midiPassTake('pass-1', 0, 0), midiPassTake('pass-3', 8, 8)],
            activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: 'pass-3' }],
        },
    ],
};

/** Notes as the store holds them for the clip: one per beat, beats 0..15. */
const NOTES: readonly ScheduledMidiNote[] = Array.from({ length: 16 }, (_, index) => ({
    id: `note-${index}`,
    pitch: 60,
    startBeat: index,
    duration: 0.5,
    velocity: 80,
    clipId: 'rec-m',
}));

function selectRegionHead(fragment: Clip): readonly ScheduledMidiNote[] {
    return selectMidiNotesForLoopWindow({
        notes: NOTES,
        iterationStartBeat: fragment.startBeat,
        loopLengthBeats: 4,
        midiOffsetBeats: fragment.midiOffsetBeats ?? 0,
        fromBeat: fragment.startBeat,
        toBeat: fragment.startBeat + 1,
        lastScheduledBeat: fragment.startBeat,
        grooveLookaroundBeats: 0,
        clipStartBeat: fragment.startBeat,
        loopOriginBeat: fragment.loopOriginBeat,
        loopEnabled: true,
    });
}

describe('comped MIDI take fragment window under an anchored looped source', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it('the region head admits the phase material the take holds, anchor stripped', () => {
        takeLaneStore.set(PASS3_LANE);

        const [, takeFragment] = resolveClipsWithComping('t1', [midiSource(0)]);

        // The fragment enters its take at media beat 8 (pass 3's head) and
        // carries no anchor: the source's anchor at 0 is meaningless in the
        // take's own basis.
        expect(takeFragment!.startBeat).toBe(8);
        expect(takeFragment!.midiOffsetBeats).toBe(16);
        expect(takeFragment!.loopOriginBeat).toBeUndefined();

        const selected = selectRegionHead(takeFragment!);

        // Carrying the anchor derived advance 8 and shifted the window to
        // [−8,−4), admitting only notes 8–11 at the wrong phase; stripped, the
        // window opens at the fragment's own offset and the head reads the
        // phase-0 material.
        const selectedIds = selected.map((note) => note.id);
        expect(selectedIds).toContain('note-0');
        expect(selectedIds).toContain('note-8');
    });

    it('an anchored source admits exactly what an unanchored one does', () => {
        takeLaneStore.set(PASS3_LANE);

        const anchored = resolveClipsWithComping('t1', [midiSource(0)]);
        const unanchored = resolveClipsWithComping('t1', [midiSource(undefined)]);

        expect(selectRegionHead(anchored[1]!).map((note) => note.id)).toEqual(
            selectRegionHead(unanchored[1]!).map((note) => note.id)
        );
    });
});
