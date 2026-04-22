import { describe, it, expect } from 'vitest';

import { createAppError } from '../createAppError';

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
        expect(error).not.toHaveProperty('details');
    });
});
