import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createBranchError } from '../BranchError';

describe('createBranchError', () => {
    it('builds a tagged Branch AppError', () => {
        const err = createBranchError('merge conflict');
        expect(err._tag).toBe('Branch');
        expect(err.message).toBe('merge conflict');
        expect(isAppError(err)).toBe(true);
    });
});
