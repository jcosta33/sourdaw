import { describe, expect, it } from 'vitest';

import { SAME_BEAT_TOLERANCE } from '../../../models/SameBeatTolerance';
import { getGrooveProjection } from '../getGrooveProjection';

// No assignment, so no groove moves a note: only the loop wrap decides the segments.
const straightProjection = getGrooveProjection({ templates: [], assignments: [] });

const CLIP = { startBeat: 4, endBeat: 12, loopLength: 4 };
const PASS_HEADS = [CLIP.startBeat, CLIP.startBeat + CLIP.loopLength];

type Note = { id: string; startBeat: number; duration: number; velocity: number };

function note(id: string, startBeat: number, duration: number): Note {
    return { id, startBeat, duration, velocity: 100 };
}

/** What the scheduler, the offline render and the export read for one loop pass. */
function projectPass(notes: Note[], iterationStartBeat: number): Note[] {
    return straightProjection.projectClipMidiEvents({
        events: notes,
        clipId: 'clip',
        clipStartBeat: CLIP.startBeat,
        clipEndBeat: CLIP.endBeat,
        iterationStartBeat,
        loopLengthBeats: CLIP.loopLength,
        midiOffsetBeats: 0,
        loopEnabled: true,
    });
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

describe('projectClipMidiEvents float residue at the loop end', () => {
    it('strikes a third-of-a-beat kick that ends on the loop end once per pass, with no wrapped tail', () => {
        for (const passHead of PASS_HEADS) {
            const segments = projectPass([note('kick', 11 / 3, 1 / 3)], passHead);

            expect(segments).toHaveLength(1);
            expect(segments[0]?.startBeat).toBeCloseTo(passHead + 11 / 3, 12);
            expect(segments[0]?.duration).toBeCloseTo(1 / 3, 12);
        }
    });

    describe.each([3, 5, 12])('on a grid of %i steps per beat', (division) => {
        const stepCount = CLIP.loopLength * division;
        const cases = Array.from({ length: stepCount }, (_, step) => step).flatMap((step) =>
            [1, 2, 3].map((length) => ({ step, length, tailSteps: step + length - stepCount }))
        );

        it.each(cases)(
            'leaves no residue for a note of $length steps from step $step',
            ({ step, length, tailSteps }) => {
                const stored = note('n', step / division, length / division);

                for (const passHead of PASS_HEADS) {
                    const segments = projectPass([stored], passHead);
                    const tailBeats = Math.max(tailSteps, 0) / division;

                    expect(segments).toHaveLength(tailBeats > 0 ? 2 : 1);
                    expect(segments.every((segment) => segment.duration > SAME_BEAT_TOLERANCE)).toBe(true);
                    expect(sum(segments.map((segment) => segment.duration))).toBeCloseTo(length / division, 12);

                    if (tailBeats > 0) {
                        const [tail] = segments;
                        expect(tail?.startBeat).toBe(passHead);
                        expect(tail?.duration).toBeCloseTo(tailBeats, 12);
                    }
                }
            }
        );
    });

    it.each([1e-8, 1e-6, 1 / 3])('still wraps a note that crosses the loop end by %d beats', (crossing) => {
        for (const passHead of PASS_HEADS) {
            const segments = projectPass([note('crossing', 11 / 3, 1 / 3 + crossing)], passHead);

            expect(segments).toHaveLength(2);
            const [tail, head] = segments;
            expect(tail?.startBeat).toBe(passHead);
            expect(tail?.duration).toBeCloseTo(crossing, 12);
            expect(head?.startBeat).toBeCloseTo(passHead + 11 / 3, 12);
            expect(head?.duration).toBeCloseTo(1 / 3, 12);
        }
    });
});
