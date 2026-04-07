import { describe, it, expect } from 'vitest';
import { createAppError } from './createAppError';
import { isAppError } from './isAppError';

describe('AppError', () => {
    it('createAppError() creates the expected flattened shape', () => {
        const error = createAppError('TestError', 'A test error', { foo: 'bar', baz: 123 });

        expect(error._tag).toBe('TestError');
        expect(error.message).toBe('A test error');
        expect(error.foo).toBe('bar');
        expect(error.baz).toBe(123);
        expect(error.cause).toBeUndefined();
    });

    it('error data fields are accessible directly (no .details)', () => {
        const error = createAppError('MyError', 'Msg', { id: 42 });
        expect(error.id).toBe(42);
        expect((error as any).details).toBeUndefined();
    });

    it('isAppError() accepts valid shared errors and rejects invalid values', () => {
        const error = createAppError('TestError', 'msg');
        expect(isAppError(error)).toBe(true);
        expect(isAppError(null)).toBe(false);
        expect(isAppError(undefined)).toBe(false);
        expect(isAppError({})).toBe(false);
        expect(isAppError({ _tag: 123 })).toBe(false);
        expect(isAppError({ _tag: 'Yes', message: 'Hi' })).toBe(true);
    });
});
