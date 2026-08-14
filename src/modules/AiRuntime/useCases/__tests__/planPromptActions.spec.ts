import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'rev-1'),
    getProjectContext: vi.fn(() => ({ tracks: [] })),
    parsePromptToActions: vi.fn(),
    repairStateStore: { value: null as null | { status: 'repair-required' } },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: mocks.repairStateStore,
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('../parsePromptToActions', () => ({
    parsePromptToActions: mocks.parsePromptToActions,
}));

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { planPromptActions } from '../planPromptActions';

describe('planPromptActions', () => {
    it('refuses to expose stale projected state to the model while raw truth requires repair', async () => {
        mocks.repairStateStore.value = { status: 'repair-required' };

        await expect(planPromptActions({ prompt: 'change the mix' })).rejects.toThrow(AiProposalInvalidatedError);
        expect(mocks.getProjectContext).not.toHaveBeenCalled();
        expect(mocks.parsePromptToActions).not.toHaveBeenCalled();
        mocks.repairStateStore.value = null;
    });
    it('returns the parsed actions when the project revision is unchanged', async () => {
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.parsePromptToActions.mockResolvedValue({ actions: [{ type: 'testAction' }], raw: 'parsed' });

        const result = await planPromptActions({ prompt: 'do something' });

        expect(result.projectRevision).toBe('rev-1');
        expect(result.result.actions).toHaveLength(1);
        expect(result.context).toEqual({ tracks: [] });
    });

    it('throws AiProposalInvalidatedError when the project revision changed during planning', async () => {
        // First call returns rev-1, second call (after parse) returns rev-2
        mocks.captureProjectRevision.mockReturnValueOnce('rev-1').mockReturnValueOnce('rev-2');
        mocks.parsePromptToActions.mockResolvedValue({ actions: [{ type: 'testAction' }], raw: 'parsed' });

        await expect(planPromptActions({ prompt: 'do something' })).rejects.toThrow(AiProposalInvalidatedError);
    });

    it('does not throw when the signal is aborted (aborted plans skip the revision check)', async () => {
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.parsePromptToActions.mockResolvedValue({ actions: [{ type: 'testAction' }], raw: 'parsed' });

        const controller = new AbortController();
        controller.abort();
        const result = await planPromptActions({ prompt: 'do something', signal: controller.signal });
        expect(result.result.actions).toHaveLength(1);
    });

    it('does not throw when parsePromptToActions returns zero actions', async () => {
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.parsePromptToActions.mockResolvedValue({ actions: [], raw: 'parsed' });

        const result = await planPromptActions({ prompt: 'unclear prompt' });
        expect(result.result.actions).toEqual([]);
    });
});
