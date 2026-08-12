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

    it('falls back to default mappings for legacy patches without a macro matrix', () => {
        const { macroMappings: _macroMappings, ...legacyPatch } = DEFAULT_PATCH;
        const patch = applyFermenterMacroMapping({ patch: legacyPatch, index: 2, value: 1 });

        expect(patch.macros[2]).toBe(1);
        expect(patch.stereoWidth).toBeCloseTo(1.85);
        expect(patch.macroMappings).toEqual(DEFAULT_PATCH.macroMappings);
    });

    it('uses patch-owned macro targets, depth, and curves', () => {
        const patch = applyFermenterMacroMapping({
            patch: {
                ...DEFAULT_PATCH,
                macroMappings: [
                    {
                        targets: [
                            {
                                target: 'filterCutoff',
                                center: 1_000,
                                depth: 500,
                                min: 100,
                                max: 2_000,
                                curve: 'linear',
                            },
                            { target: 'reverbMix', center: 0.5, depth: -0.5, min: 0, max: 1, curve: 'linear' },
                        ],
                    },
                ],
            },
            index: 0,
            value: 1,
        });

        expect(patch.macros[0]).toBe(1);
        expect(patch.filterCutoff).toBe(1_500);
        expect(patch.reverbMix).toBe(0);
    });

    it('applies fractional-cent fine-tune macro targets without quantizing them', () => {
        const patch = applyFermenterMacroMapping({
            patch: {
                ...DEFAULT_PATCH,
                macroMappings: [
                    {
                        targets: [{ target: 'oscFine', center: 0, depth: 12.5, min: -100, max: 100, curve: 'linear' }],
                    },
                ],
            },
            index: 0,
            value: 0.75,
        });

        expect(patch.oscFine).toBe(6.25);
    });

    it('clamps custom macro results to the authoritative parameter range', () => {
        const patch = applyFermenterMacroMapping({
            patch: {
                ...DEFAULT_PATCH,
                macroMappings: [
                    {
                        targets: [
                            { target: 'oscFine', center: 500, depth: 0, min: -1_000, max: 1_000, curve: 'linear' },
                        ],
                    },
                ],
            },
            index: 0,
            value: 0.5,
        });

        expect(patch.oscFine).toBe(100);
    });

    it('ignores macro targets that are not numeric patch parameters', () => {
        const patch = applyFermenterMacroMapping({
            patch: {
                ...DEFAULT_PATCH,
                macroMappings: [
                    {
                        targets: [{ target: 'name', center: 0, depth: 1, min: 0, max: 1, curve: 'linear' }],
                    },
                ],
            },
            index: 0,
            value: 1,
        });

        expect(patch.name).toBe(DEFAULT_PATCH.name);
        expect(patch.macros[0]).toBe(1);
    });
});
