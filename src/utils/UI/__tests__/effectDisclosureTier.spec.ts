import { describe, expect, it } from 'vitest';

import {
    EFFECT_DISCLOSURE_TIERS,
    effectDisclosureLevel,
    effectDisclosureTierFromLevel,
    isEffectDisclosureStageVisible,
    isEffectDisclosureTier,
} from '../effectDisclosureTier';

describe('effect disclosure tiers', () => {
    it('maps valid legacy runtime levels exactly and invalid levels to Play', () => {
        for (const [index, tier] of EFFECT_DISCLOSURE_TIERS.entries()) {
            expect(effectDisclosureTierFromLevel(index + 1)).toBe(tier);
            expect(effectDisclosureLevel(tier)).toBe(index + 1);
            expect(isEffectDisclosureTier(tier)).toBe(true);
        }
        expect(effectDisclosureTierFromLevel(0)).toBe('play');
        expect(effectDisclosureTierFromLevel(2.5)).toBe('play');
        expect(effectDisclosureTierFromLevel('5')).toBe('play');
        expect(isEffectDisclosureTier('future')).toBe(false);
    });

    it('reveals each earlier stage cumulatively', () => {
        expect(isEffectDisclosureStageVisible('lab', 'play')).toBe(true);
        expect(isEffectDisclosureStageVisible('route', 'build')).toBe(true);
        expect(isEffectDisclosureStageVisible('play', 'shape')).toBe(false);
    });
});
