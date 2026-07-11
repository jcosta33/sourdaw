import { describe, expect, it } from 'vitest';

import { validateDsoTimeSignature } from '../validateDsoTimeSignature';

describe('validateDsoTimeSignature', () => {
    it('should accept a supported time signature', () => {
        expect(validateDsoTimeSignature({ numerator: 4, denominator: 4 })).toBeNull();
    });

    it('should reject a numerator outside the supported range', () => {
        expect(validateDsoTimeSignature({ numerator: 0, denominator: 4 })).toBe(
            'Time signature numerator 0 out of range (1-32)'
        );
    });

    it('should reject an unsupported denominator', () => {
        expect(validateDsoTimeSignature({ numerator: 4, denominator: 3 })).toBe(
            'Time signature denominator 3 must be one of 2, 4, 8, or 16'
        );
    });
});
