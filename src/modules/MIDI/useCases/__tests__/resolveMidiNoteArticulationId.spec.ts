import { describe, expect, it } from 'vitest';

import { resolveMidiNoteArticulationId } from '../resolveMidiNoteArticulationId';

describe('resolveMidiNoteArticulationId', () => {
    it('maps canonical Levain articulations to immutable per-note engine ids', () => {
        expect(resolveMidiNoteArticulationId({ deviceType: 'levain', articulation: 'sustain' })).toBe(0);
        expect(resolveMidiNoteArticulationId({ deviceType: 'levain', articulation: 'staccato' })).toBe(8);
        expect(resolveMidiNoteArticulationId({ deviceType: 'levain', articulation: 'marcato' })).toBe(18);
    });

    it('refuses unknown names and instruments without a per-note articulation surface', () => {
        expect(resolveMidiNoteArticulationId({ deviceType: 'levain', articulation: 'accent' })).toBeNull();
        expect(resolveMidiNoteArticulationId({ deviceType: 'fermenter', articulation: 'staccato' })).toBeNull();
        expect(resolveMidiNoteArticulationId({ deviceType: 'levain', articulation: undefined })).toBeNull();
    });

    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
        'refuses the inherited property name %s instead of returning it as an id',
        (inherited) => {
            // The articulation string comes out of a project file, and
            // `isValidMidiArticulation` accepts any printable name. An unguarded
            // index on an object literal resolves an inherited key to a function,
            // which is not nullish — so `?? null` never fires and the function
            // reaches `port.postMessage` typed as a number, where the structured
            // clone throws and kills the scheduled note.
            const resolved = resolveMidiNoteArticulationId({ deviceType: 'levain', articulation: inherited });
            expect(resolved).toBeNull();
        }
    );
});
