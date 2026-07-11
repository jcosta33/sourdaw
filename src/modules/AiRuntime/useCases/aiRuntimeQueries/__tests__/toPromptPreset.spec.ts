import { describe, it, expect } from 'vitest';

import { type PresetAction } from '../../../models/PresetActions/Registry';
import { toPromptPreset } from '../toPromptPreset';

describe('toPromptPreset', () => {
    it('should map a preset action to the prompt preset format', () => {
        const presetAction = {
            id: 'p1',
            label: 'Test Preset',
            category: 'Track',
            isDestructive: true,
            keywords: [],
            buildAction: () => null,
        } satisfies PresetAction;

        const mapped = toPromptPreset(presetAction);

        expect(mapped).toEqual({
            id: 'p1',
            label: 'Test Preset',
            category: 'Track',
            isDestructive: true,
        });
    });

    it('should default isDestructive to false when it is undefined', () => {
        const presetAction = {
            id: 'p2',
            label: 'Test Preset 2',
            category: 'Transport',
            keywords: [],
            buildAction: () => null,
        } satisfies PresetAction;

        expect(toPromptPreset(presetAction).isDestructive).toBe(false);
    });
});
