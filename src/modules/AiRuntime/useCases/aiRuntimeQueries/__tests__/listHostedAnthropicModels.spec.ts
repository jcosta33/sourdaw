import { describe, expect, it } from 'vitest';

import { getDefaultHostedAnthropicModel } from '../getDefaultHostedAnthropicModel';
import { listHostedAnthropicModels } from '../listHostedAnthropicModels';

describe('listHostedAnthropicModels', () => {
    it('resolves the default model to one of the listed options', () => {
        const options = listHostedAnthropicModels();
        const defaultModel = getDefaultHostedAnthropicModel();

        expect(options.some((option) => option.value === defaultModel)).toBe(true);
        expect(options[0]?.value).toBe(defaultModel);
    });

    it('returns option copies so callers cannot mutate the shared catalog', () => {
        const options = listHostedAnthropicModels();
        options[0]!.value = 'tampered';

        expect(listHostedAnthropicModels()[0]?.value).not.toBe('tampered');
    });
});
