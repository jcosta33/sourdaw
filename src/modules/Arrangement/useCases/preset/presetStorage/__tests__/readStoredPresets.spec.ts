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
                resonance: 0.25,
            },
        },
    ],
    tags: ['clean', 'bass'],
    author: 'User',
    isFactory: false,
} satisfies SoundPreset;

describe('readStoredPresets', () => {
    beforeEach(() => {
        vi.resetModules();
        window.localStorage.clear();
    });

    it('should return an empty array when stored presets are not an array', async () => {
        window.localStorage.setItem(storage_key, stringify({ invalid: true }));

        const subject = await import('../readStoredPresets');

        expect(subject.readStoredPresets()).toEqual([]);
    });

    it('should drop invalid preset entries while preserving valid neighbors', async () => {
        window.localStorage.setItem(
            storage_key,
            stringify([
                valid_preset,
                { ...valid_preset, id: 99 },
                {
                    ...valid_preset,
                    id: 'preset-2',
                    devices: [
                        {
                            type: 'synth',
                            name: 'Bad',
                            parameterValues: { gain: Number.NaN },
                        },
                    ],
                },
            ])
        );

        const subject = await import('../readStoredPresets');

        expect(subject.readStoredPresets()).toEqual([valid_preset]);
    });

    it('should reject malformed nested preset fields', async () => {
        window.localStorage.setItem(
            storage_key,
            stringify([
                { ...valid_preset, id: 'bad-category', category: 'unknown' },
                { ...valid_preset, id: 'bad-track-kind', trackKind: 'bus' },
                { ...valid_preset, id: 'bad-subcategory', subcategory: 1 },
                { ...valid_preset, id: 'bad-tags', tags: ['ok', 1] },
                { ...valid_preset, id: 'bad-factory-flag', isFactory: 'false' },
            ])
        );

        const subject = await import('../readStoredPresets');

        expect(subject.readStoredPresets()).toEqual([]);
    });
});
