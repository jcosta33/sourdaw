import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'rev-1'),
    getProjectContext: vi.fn((): { tracks: never[]; projectCreatedAt?: number } => ({ tracks: [] })),
    parsePromptToActions: vi.fn(),
    recordResolvedAgentReferences: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('../parsePromptToActions', () => ({
    parsePromptToActions: mocks.parsePromptToActions,
}));

vi.mock('../agentReference/createStemImportPromptScope', () => ({ createStemImportPromptScope: vi.fn() }));
vi.mock('../agentReference/discardPreparedStemImportResources', () => ({
    discardPreparedStemImportResources: vi.fn(),
}));
vi.mock('../agentReference/getWholeProjectVibeMixScope', () => ({ getWholeProjectVibeMixScope: vi.fn(() => null) }));
vi.mock('../agentReference/prepareStemImport', () => ({ prepareStemImport: vi.fn() }));

vi.mock('../recordResolvedAgentReferences', () => ({
    recordResolvedAgentReferences: mocks.recordResolvedAgentReferences,
}));

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { planPromptActions } from '../planPromptActions';

describe('planPromptActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the parsed actions when the project revision is unchanged', async () => {
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.getProjectContext.mockReturnValue({ tracks: [], projectCreatedAt: 10 });
        const receipts = [{ id: 'track-vocals', confidence: 1, evidence: [] }];
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [{ type: 'testAction' }],
            raw: 'parsed',
            resolvedAgentReferences: receipts,
        });

        const result = await planPromptActions({ prompt: 'do something' });

        expect(result.projectRevision).toBe('rev-1');
        expect(result.result.actions).toHaveLength(1);
        expect(result.context).toEqual({ tracks: [], projectCreatedAt: 10 });
        expect(mocks.recordResolvedAgentReferences).toHaveBeenCalledWith({
            projectCreatedAt: 10,
            references: receipts,
        });
    });

    it('throws AiProposalInvalidatedError when the project revision changed during planning', async () => {
        // First call returns rev-1, second call (after parse) returns rev-2
        mocks.captureProjectRevision.mockReturnValueOnce('rev-1').mockReturnValueOnce('rev-2');
        mocks.parsePromptToActions.mockResolvedValue({ actions: [{ type: 'testAction' }], raw: 'parsed' });

        await expect(planPromptActions({ prompt: 'do something' })).rejects.toThrow(AiProposalInvalidatedError);
        expect(mocks.recordResolvedAgentReferences).not.toHaveBeenCalled();
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
