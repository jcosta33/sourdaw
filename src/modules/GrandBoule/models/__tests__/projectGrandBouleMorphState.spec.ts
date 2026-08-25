import { describe, expect, it } from 'vitest';

import { projectGrandBouleMorphState } from '../ProjectGrandBouleMorphState';

describe('projectGrandBouleMorphState', () => {
    it('projects every persisted voicing control, including tone color', () => {
        expect(
            projectGrandBouleMorphState({
                modelA: 'balanced-grand',
                modelB: 'clear-grand',
                morphPosition: 1,
                layerBalance: 0,
                enabled: true,
            })
        ).toEqual([
            { name: 'hammer_hardness_scale', value: 1.34 },
            { name: 'hammer_mass_scale', value: 0.82 },
            { name: 'soundboard_brightness', value: 0.78 },
            { name: 'sympathetic_level', value: 0.36 },
            { name: 'body_resonance', value: 0.42 },
            { name: 'tone_color', value: 0.56 },
        ]);
    });
});
