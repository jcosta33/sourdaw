import { describe, it, expect, vi } from 'vitest';

import { createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import { listBuiltinGrandBoulePresets } from '../../repositories/grandBoulePresetCatalog';
import { findMatchingGrandBoulePresetId, listGrandBoulePresets } from '../listGrandBoulePresets';

vi.mock('../../repositories/grandBoulePresetCatalog', () => ({
    listBuiltinGrandBoulePresets: vi.fn(),
}));

describe('listGrandBoulePresets', () => {
    it('should map builtin presets to summary rows', () => {
        vi.mocked(listBuiltinGrandBoulePresets).mockReturnValue([
            {
                id: 'preset-1',
                name: 'Bright',
                description: 'Test',
                parameters: createNeutralPresetParameters(),
            },
        ]);

        expect(listGrandBoulePresets()).toEqual([{ id: 'preset-1', name: 'Bright', description: 'Test' }]);
    });
});

describe('findMatchingGrandBoulePresetId', () => {
    const parameters = createNeutralPresetParameters();
    const classic = { id: 'classic', name: 'Classic', description: '', parameters };
    const alternate = {
        ...classic,
        id: 'alternate',
        parameters: { ...parameters, stereoWidth: 0.8 },
    };

    it('returns the unique factory match', () => {
        vi.mocked(listBuiltinGrandBoulePresets).mockReturnValue([alternate, classic]);

        expect(findMatchingGrandBoulePresetId({ ...parameters })).toBe(classic.id);
    });

    it('leaves ambiguous factory voicings unmarked', () => {
        vi.mocked(listBuiltinGrandBoulePresets).mockReturnValue([classic, { ...classic, id: 'duplicate' }]);

        expect(findMatchingGrandBoulePresetId(parameters)).toBeNull();
    });

    it.each(['hammerHardness', 'velocityCurve', 'stereoWidth', 'toneTilt'] as const)(
        'requires an exact match for %s',
        (key) => {
            vi.mocked(listBuiltinGrandBoulePresets).mockReturnValue([classic, alternate]);

            expect(findMatchingGrandBoulePresetId({ ...parameters, [key]: parameters[key] + 0.0001 })).toBeNull();
        }
    );
});
