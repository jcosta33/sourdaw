import { describe, it, expect, vi } from 'vitest';

import { getAvailablePresets } from '../getAvailablePresets';

// We mock the fuzzySearch to control the output
vi.mock('#/modules/AiRuntime/services/fuzzySearch', () => ({
    getAvailablePresets: vi.fn(() => [
        {
            id: 'p1',
            label: 'Preset 1',
            category: 'Global',
            isDestructive: false,
            buildAction: vi.fn(),
        },
        {
            id: 'p2',
            label: 'Preset 2',
            category: 'Track',
            isDestructive: true,
            buildAction: vi.fn(),
        },
    ]),
}));

describe('getAvailablePresets', () => {
    it('returns available presets mapped to the public PromptPreset type', () => {
        const presets = getAvailablePresets({
            selectedTrackId: undefined,
            selectedClipId: undefined,
            selectedClipType: undefined,
            trackCount: 0,
        });

        expect(presets).toHaveLength(2);
        expect(presets[0]).toEqual({
            id: 'p1',
            label: 'Preset 1',
            category: 'Global',
            isDestructive: false,
        });
        expect(presets[1]).toEqual({
            id: 'p2',
            label: 'Preset 2',
            category: 'Track',
            isDestructive: true,
        });
    });
});
