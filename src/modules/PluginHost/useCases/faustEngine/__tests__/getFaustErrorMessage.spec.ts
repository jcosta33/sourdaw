import { describe, expect, it } from 'vitest';

import { createAppError } from '#/infra/errors/createAppError';

import { getFaustErrorMessage } from '../getFaustErrorMessage';

describe('getFaustErrorMessage', () => {
    it('extracts the message from an AppError', () => {
        const error = createAppError('faust-compile', 'Compilation failed at line 42');
        expect(getFaustErrorMessage(error)).toBe('Compilation failed at line 42');
    });

    it('extracts the message from a plain Error', () => {
        const error = new Error('Something went wrong');
        expect(getFaustErrorMessage(error)).toBe('Something went wrong');
    });

    it('stringifies non-Error values', () => {
        expect(getFaustErrorMessage('raw string error')).toBe('raw string error');
        expect(getFaustErrorMessage(42)).toBe('42');
        expect(getFaustErrorMessage(null)).toBe('null');
        expect(getFaustErrorMessage(undefined)).toBe('undefined');
    });
});
