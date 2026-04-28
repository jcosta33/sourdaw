import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH } from '../../models/FermenterPatch';
import { applyFermenterMacroMapping } from '../applyFermenterMacroMapping';

describe('applyFermenterMacroMapping', () => {
    it('maps Brightness to filter cutoff and stores the macro value', () => {
        const patch = applyFermenterMacroMapping({ patch: DEFAULT_PATCH, index: 0, value: 1 });

        expect(patch.macros[0]).toBe(1);
        expect(patch.filterCutoff).toBe(12_000);
    });

    it('maps Motion to bipolar LFO filter depth', () => {
        const patch = applyFermenterMacroMapping({ patch: DEFAULT_PATCH, index: 1, value: 0.5 });

        expect(patch.macros[1]).toBe(0.5);
        expect(patch.lfoFilterAmount).toBe(0);
    });

    it('maps Dirt to drive and mix together', () => {
        const patch = applyFermenterMacroMapping({ patch: DEFAULT_PATCH, index: 3, value: 0.25 });

        expect(patch.macros[3]).toBe(0.25);
        expect(patch.distDrive).toBe(2);
        expect(patch.distMix).toBe(0.1375);
    });

    it('clamps macro values before applying mapped params', () => {
        const high = applyFermenterMacroMapping({ patch: DEFAULT_PATCH, index: 7, value: 2 });
        const low = applyFermenterMacroMapping({ patch: DEFAULT_PATCH, index: 0, value: -1 });

        expect(high.macros[7]).toBe(1);
        expect(high.chaosAmount).toBe(1);
        expect(low.macros[0]).toBe(0);
        expect(low.filterCutoff).toBe(180);
    });

    it('ignores invalid macro indices without expanding the tuple', () => {
        const patch = applyFermenterMacroMapping({ patch: DEFAULT_PATCH, index: 8, value: 1 });

        expect(patch.macros).toHaveLength(8);
        expect(patch.macros).toEqual(DEFAULT_PATCH.macros);
    });
});
