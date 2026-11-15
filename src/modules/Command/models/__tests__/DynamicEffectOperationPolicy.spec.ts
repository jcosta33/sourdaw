import { describe, expect, it } from 'vitest';

import { commandRequiresDynamicEffectsByActionType } from '../DynamicEffectOperationPolicy';

const EXPECTED = new Set<string>([
    'clearSolos',
    'scaleAutomation',
    'stretchAutomation',
    'invertAutomation',
    'reverseAutomation',
    'thinAutomation',
    'quantizeAutomation',
    'duplicateClip',
    'duplicateClipToNextBar',
    'duplicateTrack',
    'removeTrack',
    'removeClip',
]);

describe('commandRequiresDynamicEffectsByActionType', () => {
    it('marks exactly the twelve dynamic-effect operations', () => {
        const actual = new Set(
            Object.entries(commandRequiresDynamicEffectsByActionType)
                .filter(([, value]) => value)
                .map(([type]) => type)
        );
        expect(actual).toEqual(EXPECTED);
    });

    it('does not read an inherited name as set', () => {
        expect(Object.hasOwn(commandRequiresDynamicEffectsByActionType, 'constructor')).toBe(false);
        expect(Object.hasOwn(commandRequiresDynamicEffectsByActionType, 'toString')).toBe(false);
    });
});
