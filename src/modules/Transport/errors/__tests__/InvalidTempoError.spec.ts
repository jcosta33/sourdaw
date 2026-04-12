import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createInvalidTempoError } from '../InvalidTempoError';

describe('createInvalidTempoError', () => {
    it('tags the error and carries bpm in the message and payload', () => {
        const err = createInvalidTempoError(400);
        expect(err._tag).toBe('InvalidTempo');
        expect(err.bpm).toBe(400);
        expect(err.message).toContain('400');
        expect(isAppError(err)).toBe(true);
    });
});
