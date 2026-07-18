import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createFaustError } from '../FaustError';

describe('createFaustError', () => {
    it('builds a tagged Faust AppError', () => {
        const err = createFaustError('compile failed');
        expect(err._tag).toBe('Faust');
        expect(err.message).toBe('compile failed');
        expect(isAppError(err)).toBe(true);
    });
});
