import { describe, expect, it, vi } from 'vitest';

import { injectPromptCommand, onPromptInjection } from '#/modules/AiRuntime/useCases';

describe('agent control boundary', () => {
    it('keeps voice text at the bounded AiRuntime prompt-draft boundary', () => {
        const received = vi.fn<(text: string) => void>();
        const unsubscribe = onPromptInjection(received);

        injectPromptCommand('rename the selected track');

        expect(received).toHaveBeenCalledOnce();
        expect(received).toHaveBeenCalledWith('rename the selected track');
        unsubscribe();
    });
});
