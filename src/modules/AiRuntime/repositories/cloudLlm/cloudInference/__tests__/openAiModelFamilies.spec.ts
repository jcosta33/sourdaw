import { describe, expect, it } from 'vitest';

import { isGpt56FamilyModel } from '../openAiModelFamilies';

describe('isGpt56FamilyModel', () => {
    it.each(['gpt-5.6', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-luna-2026-04-01'])('is true for %s', (model) => {
        expect(isGpt56FamilyModel(model)).toBe(true);
    });

    it.each(['gpt-5', 'gpt-5-2025-08-07', 'o3', 'o1-mini', 'gpt-4-turbo', 'gpt-4o'])('is false for %s', (model) => {
        expect(isGpt56FamilyModel(model)).toBe(false);
    });
});
