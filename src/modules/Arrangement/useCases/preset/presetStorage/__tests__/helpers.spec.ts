import { beforeEach, describe, expect, it } from 'vitest';

import { type SoundPreset } from '../../../../models/SoundPreset';
import { userPresetStorage } from '../helpers';

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

describe('helpers', () => {
    beforeEach(() => {
        window.localStorage.clear();
        userPresetStorage.clear();
    });

    it('should expose the user preset storage adapter', () => {
        userPresetStorage.set([valid_preset]);

        expect(userPresetStorage.get()).toEqual([valid_preset]);
    });
});
