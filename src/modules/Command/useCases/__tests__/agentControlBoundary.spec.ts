import { describe, expect, it, vi } from 'vitest';

import * as AiRuntime from '#/modules/AiRuntime/useCases';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';

vi.mock('#/modules/Command/useCases/executeAppAction', () => ({ executeAppAction: vi.fn() }));

describe('agent control boundary', () => {
    it('routes a voice transcript only to the production draft channel before explicit user submission', () => {
        const received = vi.fn<(text: string) => void>();
        const plan = vi.spyOn(AiRuntime, 'planPromptActions');
        const execute = vi.spyOn(AiRuntime, 'executePlannedActions');
        const unsubscribe = AiRuntime.onVoicePromptDraft(received);

        AiRuntime.injectVoicePromptDraft('rename the selected track');

        expect(received).toHaveBeenCalledOnce();
        expect(received).toHaveBeenCalledWith('rename the selected track');
        expect(plan).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(vi.mocked(executeAppAction)).not.toHaveBeenCalled();
        unsubscribe();
    });
});
