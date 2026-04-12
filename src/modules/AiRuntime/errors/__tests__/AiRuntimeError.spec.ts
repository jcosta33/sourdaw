import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createAiRuntimeError } from '../AiRuntimeError';

describe('createAiRuntimeError', () => {
    it('builds a tagged AiRuntime AppError', () => {
        const err = createAiRuntimeError('model missing');
        expect(err._tag).toBe('AiRuntime');
        expect(err.message).toBe('model missing');
        expect(isAppError(err)).toBe(true);
    });

    it('attaches an optional cause', () => {
        const inner = new Error('timeout');
        const err = createAiRuntimeError('inference failed', inner);
        expect(err.cause).toBe(inner);
    });
});
