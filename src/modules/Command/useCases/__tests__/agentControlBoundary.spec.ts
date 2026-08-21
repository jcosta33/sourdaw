import { describe, expect, it, vi } from 'vitest';

import {
    createVoicePromptDraftAdmission,
    injectVoicePromptDraft,
    onVoicePromptDraft,
} from '#/modules/AiRuntime/useCases';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';

vi.mock('#/modules/Command/useCases/executeAppAction', () => ({ executeAppAction: vi.fn() }));

describe('agent control boundary', () => {
    it('routes a voice transcript only to the production draft channel before explicit user submission', () => {
        const appendDraft = vi.fn();
        const rejectBusyDraft = vi.fn();
        const admit = createVoicePromptDraftAdmission({ isBusy: () => false, appendDraft, rejectBusyDraft });
        const unsubscribe = onVoicePromptDraft(admit);

        injectVoicePromptDraft('rename the selected track');

        expect(appendDraft).toHaveBeenCalledOnce();
        expect(appendDraft).toHaveBeenCalledWith('rename the selected track');
        expect(rejectBusyDraft).not.toHaveBeenCalled();
        expect(vi.mocked(executeAppAction)).not.toHaveBeenCalled();
        unsubscribe();
    });
});
