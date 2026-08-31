import { describe, expect, it } from 'vitest';

import { isOpenAiReasoningModel } from '../openAiModelFamilies';

describe('isOpenAiReasoningModel', () => {
    it.each(['gpt-5.6-luna', 'gpt-5.6', 'gpt-5x', 'o1', 'o3-mini'])('is true for %s', (model) => {
        expect(isOpenAiReasoningModel(model)).toBe(true);
    });

    it.each(['gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'])('is false for %s', (model) => {
        expect(isOpenAiReasoningModel(model)).toBe(false);
    });
});
