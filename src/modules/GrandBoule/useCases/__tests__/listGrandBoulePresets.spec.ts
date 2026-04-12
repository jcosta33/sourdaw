import { describe, it, expect, vi } from 'vitest';
import { createNeutralPresetParameters } from '#/modules/GrandBoule/models/GrandBoulePreset';
import { listGrandBoulePresets } from '../listGrandBoulePresets';
import { listBuiltinGrandBoulePresets } from '../../repositories/grandBoulePresetCatalog';

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

        expect(listGrandBoulePresets()).toEqual([
            { id: 'preset-1', name: 'Bright', description: 'Test' },
        ]);
    });
});
