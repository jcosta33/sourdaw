import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { projectClipMidiEvents } from '../projectClipMidiEvents';

/**
 * #4988, first consequence, MIDI: trimming a looped clip's start must show a
 * different portion of the same loop, not slide the loop window. The issue's
 * example is a 4-beat loop holding notes at source beats 0 and 4.5; before the
 * trim only the beat-0 note sounds, and after a one-beat trim the 4.5 note
 * must still never sound, in any pass, live or offline — this projector is the
 * one loop-window law every scheduling path shares. A clip without an anchor
 * keeps the pre-anchor law, whose window ceiling slid with the trim.
 */

type GateEvent = { id: string; startBeat: number; duration: number; velocity: number };

const IN_LOOP_NOTE: GateEvent = { id: 'head', startBeat: 0, duration: 0.5, velocity: 80 };
const PAST_LOOP_NOTE: GateEvent = { id: 'late', startBeat: 4.5, duration: 0.5, velocity: 80 };

function projectPass(input: {
    clipStartBeat: number;
    iterationStartBeat: number;
    midiOffsetBeats: number;
    loopOriginBeat: number | undefined;
    events: readonly GateEvent[];
}): Array<{ id: string; startBeat: number }> {
    return projectClipMidiEvents({
        events: input.events,
        clipId: 'clip-4988',
        clipStartBeat: input.clipStartBeat,
        clipEndBeat: input.clipStartBeat + 16,
        iterationStartBeat: input.iterationStartBeat,
        loopLengthBeats: 4,
        midiOffsetBeats: input.midiOffsetBeats,
        loopEnabled: true,
        loopOriginBeat: input.loopOriginBeat,
        clipGrooveAlreadyApplied: true,
    }).map((event) => ({ id: event.id, startBeat: event.startBeat }));
}

describe('projectClipMidiEvents with a loop anchor', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('plays only the in-region note before the trim', () => {
        const projected = projectPass({
            clipStartBeat: 0,
            iterationStartBeat: 0,
            midiOffsetBeats: 0,
            loopOriginBeat: 0,
            events: [IN_LOOP_NOTE, PAST_LOOP_NOTE],
        });
        expect(projected).toEqual([{ id: 'head', startBeat: 0 }]);
    });

    it('keeps the 4.5 note out of every pass after a one-beat start trim', () => {
        // Trim by one beat: the clip now starts at 1 and its head enters the
        // source at 1. The head note wraps to the pass tail (phase 3) and the
        // 4.5 note stays outside the loop region.
        const projected = projectPass({
            clipStartBeat: 1,
            iterationStartBeat: 1,
            midiOffsetBeats: 1,
            loopOriginBeat: 0,
            events: [IN_LOOP_NOTE, PAST_LOOP_NOTE],
        });
        expect(projected).toEqual([{ id: 'head', startBeat: 4 }]);
    });

    it('keeps the anchored window when the offset wraps past the loop length', () => {
        // Five beats trimmed in total: the stored offset wrapped down to 1 and
        // #5022 shifted the stored notes down by 4. Same notes, same phases,
        // same exclusion — the window must not ride the wrap.
        const shifted: GateEvent[] = [
            { ...IN_LOOP_NOTE, startBeat: -4 },
            { ...PAST_LOOP_NOTE, startBeat: 0.5 },
        ];
        const projected = projectPass({
            clipStartBeat: 5,
            iterationStartBeat: 5,
            midiOffsetBeats: 1,
            loopOriginBeat: 0,
            events: shifted,
        });
        expect(projected).toEqual([{ id: 'head', startBeat: 8 }]);
    });

    it('keeps every pass of the arrangement in the same occurrence', () => {
        // The second pass projects the same notes at the same pass phases as
        // the first: the trim moves the entry, never the loop's content.
        const firstPass = projectPass({
            clipStartBeat: 1,
            iterationStartBeat: 1,
            midiOffsetBeats: 1,
            loopOriginBeat: 0,
            events: [IN_LOOP_NOTE],
        });
        const secondPass = projectPass({
            clipStartBeat: 1,
            iterationStartBeat: 5,
            midiOffsetBeats: 1,
            loopOriginBeat: 0,
            events: [IN_LOOP_NOTE],
        });
        expect(firstPass).toEqual([{ id: 'head', startBeat: 4 }]);
        expect(secondPass).toEqual([{ id: 'head', startBeat: 8 }]);
    });
});

describe('projectClipMidiEvents without a loop anchor (legacy projects)', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('keeps the pre-anchor window exactly: the offset-relative ceiling decides', () => {
        // The same trimmed state as the anchored case above, but the clip
        // carries no anchor, so the pre-anchor one-sided law applies: the
        // relative 3.5 note is admitted and the relative −1 note wraps. This
        // is the behavior a project written before the anchor keeps.
        const projected = projectPass({
            clipStartBeat: 1,
            iterationStartBeat: 1,
            midiOffsetBeats: 1,
            loopOriginBeat: undefined,
            events: [IN_LOOP_NOTE, PAST_LOOP_NOTE],
        });
        expect(projected.map((event) => event.id)).toEqual(['head', 'late']);
        expect(projected[0]?.startBeat).toBe(4);
        expect(projected[1]?.startBeat).toBe(4.5);
    });
});
