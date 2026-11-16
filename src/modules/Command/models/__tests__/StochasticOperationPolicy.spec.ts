import { describe, expect, it } from 'vitest';

import { commandRequiresSeedByActionType } from '../StochasticOperationPolicy';

const EXPECTED = new Set<string>([
    'generateChordProgression',
    'generateDrumPattern',
    'generateMelody',
    'humanizeNotes',
]);

describe('commandRequiresSeedByActionType', () => {
    it('requires a seed for exactly the four stochastic operations', () => {
        const actual = new Set(
            Object.entries(commandRequiresSeedByActionType)
                .filter(([, value]) => value)
                .map(([type]) => type)
        );
        expect(actual).toEqual(EXPECTED);
    });

    it('does not read an inherited name as set', () => {
        expect(Object.hasOwn(commandRequiresSeedByActionType, 'constructor')).toBe(false);
        expect(Object.hasOwn(commandRequiresSeedByActionType, 'toString')).toBe(false);
    });
});
