import { describe, it, expect, vi } from 'vitest';

import { resolvePresetActions } from '../resolvePresetActions';

vi.mock('#/modules/AiRuntime/models/PresetActions/Registry', () => ({
    PRESET_ACTIONS: [
        {
            id: 'single-action',
            buildAction: () => ({ type: 'testAction1', payload: {} }),
        },
        {
            id: 'multi-action',
            buildAction: () => [
                { type: 'testAction1', payload: {} },
                { type: 'testAction2', payload: {} },
            ],
        },
        {
            id: 'null-action',
            buildAction: () => null,
        },
    ],
}));

describe('resolvePresetActions', () => {
    const context = {
        selectedTrackId: undefined,
        selectedClipId: undefined,
        selectedClipType: undefined,
        trackCount: 1,
    };

    it('returns an empty array if preset is not found', () => {
        const result = resolvePresetActions({ presetId: 'missing', context });
        expect(result).toEqual([]);
    });

    it('returns an empty array if buildAction returns null', () => {
        const result = resolvePresetActions({ presetId: 'null-action', context });
        expect(result).toEqual([]);
    });

    it('wraps a single action in an array', () => {
        const result = resolvePresetActions({ presetId: 'single-action', context });
        expect(result).toHaveLength(1);
        expect(result[0]!.type).toBe('testAction1');
    });

    it('returns multiple actions as-is', () => {
        const result = resolvePresetActions({ presetId: 'multi-action', context });
        expect(result).toHaveLength(2);
        expect(result[0]!.type).toBe('testAction1');
        expect(result[1]!.type).toBe('testAction2');
    });
});
