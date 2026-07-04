import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type DevicePreset } from '../../../../models/SoundPreset';

const devices = [
    {
        type: 'synth',
        name: 'Lead',
        parameterValues: {
            drive: 0.5,
        },
    },
] satisfies DevicePreset[];

describe('saveCurrentAsPreset', () => {
    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should save the current preset through user preset storage defaults', async () => {
        const subject = await import('../saveCurrentAsPreset');
        const reader = await import('../readStoredPresets');

        const result = subject.saveCurrentAsPreset({
            name: 'My Lead',
            category: 'lead',
            trackKind: 'midi',
            devices,
        });

        expect(result.id).toMatch(/^user-preset-/);
        expect(result).toEqual({
            id: result.id,
            name: 'My Lead',
            category: 'lead',
            description: '',
            trackKind: 'midi',
            devices,
            tags: [],
            author: 'User',
            isFactory: false,
        });
        expect(reader.readStoredPresets()).toEqual([result]);
    });
});
