import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createNeutralPresetParameters } from '#/modules/GrandBoule/models/GrandBoulePreset';
import { listGrandBoulePresets } from '../listGrandBoulePresets';

describe('listGrandBoulePresets', () => {
    it('should map builtin presets to summary rows', () => {
        const listBuiltinGrandBoulePresets = vi.fn(() => [
            {
                id: 'preset-1',
                name: 'Bright',
                description: 'Test',
                parameters: createNeutralPresetParameters(),
            },
        ]);
        injectDependencies(listGrandBoulePresets, { listBuiltinGrandBoulePresets });

        expect(listGrandBoulePresets()).toEqual([
            { id: 'preset-1', name: 'Bright', description: 'Test' },
        ]);
    });
});
