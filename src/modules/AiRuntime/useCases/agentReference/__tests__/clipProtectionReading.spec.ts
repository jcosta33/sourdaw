import { describe, expect, it } from 'vitest';

import { clipProtectionReading } from '../clipProtectionReading';

describe('clipProtectionReading.statesClipNoun', () => {
    it.each([
        ['keep the Missing clip punchy', true],
        ['leave the clips alone', true],
        ['keep "Clip Art" punchy', false],
        ['keep the "Missing clip" punchy', false],
        ['keep the Kick level punchy', false],
        ['keep the clipping down', false],
    ])('reads "%s" as stating the clip noun: %s', (text, expected) => {
        expect(clipProtectionReading.statesClipNoun(text)).toBe(expected);
    });
});
