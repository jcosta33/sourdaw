import { describe, expect, it } from 'vitest';

import { DEFAULT_HOSTED_ANTHROPIC_MODEL, HOSTED_ANTHROPIC_MODELS } from '../HostedAnthropicModels';

describe('HostedAnthropicModels', () => {
    it('resolves the default model to the catalog entry the picker lists first', () => {
        expect(HOSTED_ANTHROPIC_MODELS[0]?.value).toBe(DEFAULT_HOSTED_ANTHROPIC_MODEL);
    });

    it('pins the current recommended model as the default, not an empty or arbitrary value', () => {
        expect(DEFAULT_HOSTED_ANTHROPIC_MODEL).toBe('claude-sonnet-5');
    });

    it('never leaves a catalog entry with an empty model value', () => {
        expect(HOSTED_ANTHROPIC_MODELS.length).toBeGreaterThan(0);
        for (const model of HOSTED_ANTHROPIC_MODELS) {
            expect(model.value.length).toBeGreaterThan(0);
        }
    });

    it('never pins a superseded dated model id', () => {
        for (const model of HOSTED_ANTHROPIC_MODELS) {
            expect(model.value).not.toMatch(/\d{8}$/u);
        }
    });
});
