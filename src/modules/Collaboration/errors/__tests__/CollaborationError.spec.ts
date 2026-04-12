import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createCollaborationError } from '../CollaborationError';

describe('createCollaborationError', () => {
    it('builds a tagged Collaboration AppError', () => {
        const err = createCollaborationError('session lost');
        expect(err._tag).toBe('Collaboration');
        expect(err.message).toBe('session lost');
        expect(isAppError(err)).toBe(true);
    });

    it('attaches an optional cause', () => {
        const inner = new Error('network');
        const err = createCollaborationError('sync failed', inner);
        expect(err.cause).toBe(inner);
    });
});
