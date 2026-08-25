import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'rev-1'),
    getProjectContext: vi.fn(() => ({ tracks: [] })),
    parsePromptToActions: vi.fn(),
    prepareStemImport: vi.fn(),
    createStemImportPromptScope: vi.fn(),
    discardRawPreparedStemImportResources: vi.fn(),
    registerPreparedStemImportResources: vi.fn(),
    discardRegisteredPreparedStemImportResources: vi.fn(),
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
vi.mock('../agentReference/prepareStemImport', () => ({
    prepareStemImport: mocks.prepareStemImport,
}));
vi.mock('../agentReference/createStemImportPromptScope', () => ({
    createStemImportPromptScope: mocks.createStemImportPromptScope,
}));
vi.mock('../agentReference/discardPreparedStemImportResources', () => ({
    discardPreparedStemImportResources: mocks.discardRawPreparedStemImportResources,
}));
vi.mock('../agentReference/registerPreparedStemImportResources', () => ({
    preparedStemImportResources: {
        register: mocks.registerPreparedStemImportResources,
        discard: mocks.discardRegisteredPreparedStemImportResources,
    },
}));

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { planPromptActions } from '../planPromptActions';

const stemImportScope = {
    actionSeed: {
        stems: [{ audioBufferId: 'prepared-buffer-1', assetLeaseId: 'prepared-lease-1' }],
    },
};

function seedAdmittedRun(): void {
    agentRunLifecycle.create({ runId: 'stem-run', request: 'Import stems', mode: 'apply', createdRevision: 'rev-1' });
}

describe('planPromptActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentRunLifecycle.clear();
        mocks.captureProjectRevision.mockReset().mockReturnValue('rev-1');
        mocks.parsePromptToActions.mockReset();
        mocks.prepareStemImport.mockReset().mockResolvedValue({ status: 'prepared' });
        mocks.createStemImportPromptScope.mockReset().mockReturnValue(stemImportScope);
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

    it('does not start a model correction without application-owned attempt admission', async () => {
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [],
            raw: 'rejected',
            rejectionReason: 'The proposed action schema is invalid.',
        });
        const callsBeforePlanning = mocks.parsePromptToActions.mock.calls.length;

        const result = await planPromptActions({ prompt: 'do something' });

        expect(result.result.rejectionReason).toBe('The proposed action schema is invalid.');
        expect(mocks.parsePromptToActions).toHaveBeenCalledTimes(callsBeforePlanning + 1);
    });

    it('runs one admitted correction and retains the validation failure as durable run evidence', async () => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000003');
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.parsePromptToActions
            .mockResolvedValueOnce({
                actions: [],
                raw: 'rejected',
                rejectionReason: 'The proposed action schema is invalid.',
            })
            .mockResolvedValueOnce({ actions: [{ type: 'testAction' }], raw: 'corrected' });
        const callsBeforePlanning = mocks.parsePromptToActions.mock.calls.length;

        try {
            const result = await planPromptActions({
                prompt: 'do something',
                onProviderAttempt: () => ({ status: 'admitted' }),
            });

            expect(result.result.actions).toHaveLength(1);
        } finally {
            randomUuid.mockRestore();
        }

        expect(mocks.parsePromptToActions).toHaveBeenCalledTimes(callsBeforePlanning + 2);
        expect(agentRunLifecycle.get('agent-run-00000000-0000-0000-0000-000000000003')).toMatchObject({
            phase: 'completed',
            errors: [
                expect.objectContaining({
                    code: 'agent.schema',
                    category: 'schema',
                    related: expect.objectContaining({
                        workIds: ['planning:agent-run-00000000-0000-0000-0000-000000000003'],
                    }),
                }),
            ],
        });
    });

    it('terminalizes an auto-created run as cancelled before pre-aborted planning can complete it', async () => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        mocks.parsePromptToActions.mockResolvedValue({ actions: [], raw: 'cancelled' });
        const controller = new AbortController();
        controller.abort();

        try {
            await planPromptActions({ prompt: 'do something', signal: controller.signal });
        } finally {
            randomUuid.mockRestore();
        }

        expect(agentRunLifecycle.get('agent-run-00000000-0000-0000-0000-000000000001')).toMatchObject({
            phase: 'cancelled',
            cancellation: { generation: 1 },
        });
    });

    it('keeps an auto-created run cancelled when planning aborts while parsing', async () => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000002');
        mocks.captureProjectRevision.mockReturnValue('rev-1');
        const controller = new AbortController();
        mocks.parsePromptToActions.mockImplementation(async () => {
            controller.abort();
            return { actions: [], raw: 'cancelled' };
        });

        try {
            await planPromptActions({ prompt: 'do something', signal: controller.signal });
        } finally {
            randomUuid.mockRestore();
        }

        expect(agentRunLifecycle.get('agent-run-00000000-0000-0000-0000-000000000002')).toMatchObject({
            phase: 'cancelled',
            cancellation: { generation: 1 },
        });
    });

    it('keeps a shared admitted run cancelled when provider planning rejects after abort', async () => {
        const runId = 'shared-admitted-run';
        const controller = new AbortController();
        agentRunLifecycle.create({ runId, request: 'do something', mode: 'apply', createdRevision: 'rev-1' });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning', revision: 'rev-1' });
        controller.signal.addEventListener(
            'abort',
            () => void agentRunCancellation.cancel({ runId, reason: 'Originating request aborted.' }),
            { once: true }
        );
        mocks.parsePromptToActions.mockImplementation(async () => {
            controller.abort();
            throw new DOMException('Provider planning aborted.', 'AbortError');
        });

        await expect(
            planPromptActions({
                prompt: 'do something',
                signal: controller.signal,
                streamIdentity: { runId, requestId: 'request-1', cancellationGeneration: 0 },
            })
        ).rejects.toMatchObject({ name: 'AbortError' });

        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'cancelled',
            cancellation: { generation: 1 },
            errors: [expect.objectContaining({ category: 'cancellation' })],
        });
    });

    it('discards registered prepared stems through their owner when provider replanning throws', async () => {
        seedAdmittedRun();
        mocks.parsePromptToActions
            .mockResolvedValueOnce({ actions: [], preparationRequest: 'stem-import' })
            .mockRejectedValueOnce(new Error('Provider replanning failed'));

        await expect(
            planPromptActions({
                prompt: 'Import stems',
                streamIdentity: { runId: 'stem-run', requestId: 'request-1', cancellationGeneration: 0 },
            })
        ).rejects.toThrow('Provider replanning failed');

        expect(mocks.discardRegisteredPreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: 'stem-run',
            stems: stemImportScope.actionSeed.stems,
        });
        expect(mocks.discardRawPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it('discards registered prepared stems through their owner when replanning rejects the import', async () => {
        seedAdmittedRun();
        mocks.parsePromptToActions
            .mockResolvedValueOnce({ actions: [], preparationRequest: 'stem-import' })
            .mockResolvedValueOnce({ actions: [], rejectionReason: 'Import rejected' });

        await planPromptActions({
            prompt: 'Import stems',
            streamIdentity: { runId: 'stem-run', requestId: 'request-1', cancellationGeneration: 0 },
        });

        expect(mocks.discardRegisteredPreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: 'stem-run',
            stems: stemImportScope.actionSeed.stems,
        });
        expect(mocks.discardRawPreparedStemImportResources).not.toHaveBeenCalled();
    });

    it('discards registered prepared stems through their owner when the project revision invalidates the plan', async () => {
        seedAdmittedRun();
        mocks.captureProjectRevision.mockReturnValueOnce('rev-1').mockReturnValueOnce('rev-2');
        mocks.parsePromptToActions
            .mockResolvedValueOnce({ actions: [], preparationRequest: 'stem-import' })
            .mockResolvedValueOnce({ actions: [{ type: 'importStemSet', payload: stemImportScope.actionSeed }] });

        await expect(
            planPromptActions({
                prompt: 'Import stems',
                streamIdentity: { runId: 'stem-run', requestId: 'request-1', cancellationGeneration: 0 },
            })
        ).rejects.toThrow(AiProposalInvalidatedError);

        expect(mocks.discardRegisteredPreparedStemImportResources).toHaveBeenCalledExactlyOnceWith({
            runId: 'stem-run',
            stems: stemImportScope.actionSeed.stems,
        });
        expect(mocks.discardRawPreparedStemImportResources).not.toHaveBeenCalled();
    });
});
