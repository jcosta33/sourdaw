import { describe, it, expect } from 'vitest';

import { applyMorphedPatch } from '../applyMorphedPatch';

describe('applyMorphedPatch (unit surface)', () => {
    it('exports a callable applyMorphedPatch function', () => {
        // The detailed routing (eligibility gate, DSP-id mapping, rAF
        // coalescing, undefined-dependency branches) is covered in
        // useCases/__tests__/presetMorph.spec.ts. This spec only pins the
        // public surface so an accidental rename is caught here.
        expect(typeof applyMorphedPatch).toBe('function');
    });
});
