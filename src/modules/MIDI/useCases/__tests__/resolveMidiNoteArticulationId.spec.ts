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
});
