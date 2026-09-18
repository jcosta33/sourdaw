import { describe, expect, it } from 'vitest';

import { isNegatedIntent } from '../isNegatedIntent';

describe('isNegatedIntent', () => {
    it('does not match words that contain the intent verb as a substring', () => {
        expect(isNegatedIntent('do not touch the preset', 'set')).toBe(false);
        expect(isNegatedIntent('do not reset the filter', 'set')).toBe(false);
        expect(isNegatedIntent('do not offset', 'set')).toBe(false);
        expect(isNegatedIntent('do not change setting', 'set')).toBe(false);
    });

    it('identifies negation patterns preceding the intent verb', () => {
        expect(isNegatedIntent('do not set the cutoff', 'set')).toBe(true);
        expect(isNegatedIntent('dont set', 'set')).toBe(true);
        expect(isNegatedIntent('don t set', 'set')).toBe(true);
        expect(isNegatedIntent('never set', 'set')).toBe(true);
        expect(isNegatedIntent('not set', 'set')).toBe(true);
    });

    it('returns false for positive prompts', () => {
        expect(isNegatedIntent('set the cutoff to 800', 'set')).toBe(false);
        expect(isNegatedIntent('adjust the frequency', 'set')).toBe(false);
    });

    it('returns false when the intent phrase is missing from the prompt', () => {
        expect(isNegatedIntent('mute track 1', 'set')).toBe(false);
        expect(isNegatedIntent('', 'set')).toBe(false);
    });

    it('handles multi-word intent phrases respecting word boundaries', () => {
        expect(isNegatedIntent('do not turn down the master', 'turn down')).toBe(true);
        expect(isNegatedIntent('downturn the gain', 'turn down')).toBe(false);
        expect(isNegatedIntent('do not downturn the gain', 'turn down')).toBe(false);
    });
});
