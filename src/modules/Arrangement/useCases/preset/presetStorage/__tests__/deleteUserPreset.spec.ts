import { stringify } from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SoundPreset } from '../../../../models/SoundPreset';

const storage_key = 'sourdaw-user-presets';

const first_preset = {
    id: 'preset-1',
    name: 'First',
    category: 'bass',
    description: 'First user preset',
    trackKind: 'midi',
    devices: [],
    tags: ['first'],
    author: 'User',
    isFactory: false,
} satisfies SoundPreset;

const second_preset = {
    ...first_preset,
    id: 'preset-2',
    name: 'Second',
} satisfies SoundPreset;

describe('deleteUserPreset', () => {
    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should delete from sanitized stored presets', async () => {
        window.localStorage.setItem(storage_key, stringify([first_preset, { ...first_preset, id: 99 }, second_preset]));

        const subject = await import('../deleteUserPreset');
        const reader = await import('../readStoredPresets');

        subject.deleteUserPreset('preset-1');

        expect(reader.readStoredPresets()).toEqual([second_preset]);
    });
});
