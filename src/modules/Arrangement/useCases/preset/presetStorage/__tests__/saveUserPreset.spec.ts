import { stringify } from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SoundPreset } from '../../../../models/SoundPreset';

const storage_key = 'sourdaw-user-presets';

const valid_preset = {
    id: 'preset-1',
    name: 'Clean Bass',
    category: 'bass',
    description: 'Stable user preset',
    trackKind: 'midi',
    devices: [
        {
            type: 'synth',
            name: 'Sub',
            parameterValues: {
                cutoff: 1200,
            },
        },
    ],
    tags: ['clean'],
    author: 'User',
    isFactory: false,
} satisfies SoundPreset;

describe('saveUserPreset', () => {
    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should append to sanitized stored presets', async () => {
        window.localStorage.setItem(storage_key, stringify([valid_preset, { ...valid_preset, id: 99 }]));

        const subject = await import('../saveUserPreset');
        const reader = await import('../readStoredPresets');

        const result = subject.saveUserPreset({
            name: 'My Bass',
            category: 'bass',
            description: 'Saved',
            trackKind: 'midi',
            devices: valid_preset.devices,
            tags: ['mine'],
        });

        expect(result.id).toMatch(/^user-preset-/);
        expect(result).toEqual({
            id: result.id,
            name: 'My Bass',
            category: 'bass',
            description: 'Saved',
            trackKind: 'midi',
            devices: valid_preset.devices,
            tags: ['mine'],
            author: 'User',
            isFactory: false,
        });
        expect(reader.readStoredPresets()).toEqual([valid_preset, result]);
    });
});
