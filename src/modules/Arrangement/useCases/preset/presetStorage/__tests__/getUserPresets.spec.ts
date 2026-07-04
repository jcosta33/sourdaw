import { stringify } from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SoundPreset } from '../../../../models/SoundPreset';

const storage_key = 'sourdaw-user-presets';

const valid_preset = {
    id: 'preset-1',
    name: 'Clean Lead',
    category: 'lead',
    description: 'Stable lead',
    subcategory: 'mono',
    trackKind: 'midi',
    devices: [
        {
            type: 'synth',
            name: 'Lead',
            parameterValues: {
                drive: 0.4,
            },
        },
    ],
    tags: ['lead'],
    author: 'User',
    isFactory: false,
} satisfies SoundPreset;

describe('getUserPresets', () => {
    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should expose only valid user presets from storage', async () => {
        window.localStorage.setItem(
            storage_key,
            stringify([
                valid_preset,
                { ...valid_preset, id: 'preset-2', tags: ['ok', 1] },
                { ...valid_preset, id: 'preset-3', category: 'unknown' },
            ])
        );

        const subject = await import('../getUserPresets');

        expect(subject.getUserPresets()).toEqual([valid_preset]);
    });
});
