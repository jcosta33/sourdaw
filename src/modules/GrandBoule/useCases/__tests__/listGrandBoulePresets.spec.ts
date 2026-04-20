import { describe, it, expect, vi } from 'vitest';

import { createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import { listBuiltinGrandBoulePresets } from '../../repositories/grandBoulePresetCatalog';
import { listGrandBoulePresets } from '../listGrandBoulePresets';

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
