import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createAiGenerationError } from '../AiGenerationError';

describe('createAiGenerationError', () => {
    it('builds a tagged AiGeneration AppError', () => {
        const err = createAiGenerationError('bad prompt');
        expect(err._tag).toBe('AiGeneration');
        expect(err.message).toBe('bad prompt');
        expect(isAppError(err)).toBe(true);
    });

    it('attaches an optional cause', () => {
        const inner = new Error('upstream');
        const err = createAiGenerationError('generation failed', inner);
        expect(err.cause).toBe(inner);
    });
});
