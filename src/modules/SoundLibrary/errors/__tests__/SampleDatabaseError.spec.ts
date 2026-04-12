import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createSampleDatabaseError } from '../SampleDatabaseError';

describe('createSampleDatabaseError', () => {
    it('builds a tagged SampleDatabase AppError', () => {
        const err = createSampleDatabaseError('index corrupt');
        expect(err._tag).toBe('SampleDatabase');
        expect(err.message).toBe('index corrupt');
        expect(isAppError(err)).toBe(true);
    });
});
