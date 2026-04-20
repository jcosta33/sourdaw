import { describe, it, expect } from 'vitest';

import { createAppError } from '../createAppError';
import { isAppError } from '../isAppError';

describe('AppError', () => {
    describe('createAppError', () => {
        it('should create an AppError with minimal arguments', () => {
            const error = createAppError('TestError', 'A test error occurred');
            expect(error).toEqual({
                _tag: 'TestError',
                message: 'A test error occurred',
            });
        });

        it('should create an AppError with data fields and cause', () => {
            const cause = new Error('root cause');
            const error = createAppError('DetailedError', 'A detailed error', { id: 123, name: 'test' }, cause);

            expect(error._tag).toBe('DetailedError');
            expect(error.message).toBe('A detailed error');
            expect(error.id).toBe(123);
            expect(error.name).toBe('test');
            expect(error.cause).toBe(cause);
        });

        it('should not include cause property when cause is omitted', () => {
            const error = createAppError('TestError', 'msg');
            expect('cause' in error).toBe(false);
        });
    });

    describe('isAppError', () => {
        it('should return true for valid AppError objects', () => {
            const error = createAppError('TestError', 'Test', { id: 1 });
            expect(isAppError(error)).toBe(true);
        });

        it('should return false for invalid objects', () => {
            expect(isAppError(null)).toBe(false);
            expect(isAppError(undefined)).toBe(false);
            expect(isAppError('string')).toBe(false);
            expect(isAppError({})).toBe(false);
            expect(isAppError({ _tag: 'Test' })).toBe(false);
            expect(isAppError({ message: 'Test' })).toBe(false);
        });
    });
});
