import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createSdawFormatError } from '../SdawFormatError';

describe('createSdawFormatError', () => {
    it('builds a tagged SdawFormat AppError', () => {
        const err = createSdawFormatError('bad header');
        expect(err._tag).toBe('SdawFormat');
        expect(err.message).toBe('bad header');
        expect(isAppError(err)).toBe(true);
    });
});
