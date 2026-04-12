import { describe, expect, it } from 'vitest';

import { createAppError } from '../createAppError';
import { isAppError } from '../isAppError';

describe('isAppError', () => {
    it('returns true for AppError-shaped objects and createAppError results', () => {
        expect(isAppError(createAppError('TestError', 'msg'))).toBe(true);
        expect(isAppError({ _tag: 'Yes', message: 'Hi' })).toBe(true);
    });

    it('returns false for non-objects and malformed tags', () => {
        expect(isAppError(null)).toBe(false);
        expect(isAppError(undefined)).toBe(false);
        expect(isAppError('x')).toBe(false);
        expect(isAppError(new Error('x'))).toBe(false);
        expect(isAppError({})).toBe(false);
        expect(isAppError({ _tag: 123 })).toBe(false);
    });

    it('returns false when message is missing or not a string', () => {
        expect(isAppError({ _tag: 'x' })).toBe(false);
        expect(isAppError({ _tag: 'x', message: 1 })).toBe(false);
    });
});
