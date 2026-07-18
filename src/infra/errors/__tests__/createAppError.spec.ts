import { describe, it, expect } from 'vitest';

import { createAppError, type AppError } from '../createAppError';

describe('createAppError', () => {
    it('creates error with tag and message', () => {
        const error = createAppError('TestError', 'something broke');
        expect(error._tag).toBe('TestError');
        expect(error.message).toBe('something broke');
        expect(error).toBeInstanceOf(Error);
    });

    it('includes data properties', () => {
        const error = createAppError('TestError', 'fail', { code: 42, detail: 'extra' });
        expect((error as { code: number }).code).toBe(42);
        expect((error as { detail: string }).detail).toBe('extra');
    });

    it('attaches cause when provided', () => {
        const root = new Error('root cause');
        const error = createAppError('Wrapped', 'wrapper', undefined, root);
        expect(error.cause).toBe(root);
    });

    it('does not attach cause when undefined', () => {
        const error = createAppError('Test', 'msg');
        expect(error.cause).toBeUndefined();
    });

    it('preserves tag through type system', () => {
        const error: AppError<'Custom'> = createAppError('Custom', 'typed');
        expect(error._tag).toBe('Custom');
    });
});
