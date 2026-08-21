import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    reserveBudget: vi.fn(() => ({ status: 'reserved' })),
    create: vi.fn(),
    get: vi.fn(() => ({ phase: 'planning', budgets: { limits: {}, consumed: {} } })),
    transitionPhase: vi.fn(),
    planPromptActions: vi.fn(),
    notifyAiChange: vi.fn(),
    claim: vi.fn(() => ({
        status: 'claimed' as const,
        lease: {
            runId: 'prompt-run-1',
            workId: 'provider-planning',
            leaseId: 'provider-lease-1',
            cancellationGeneration: 0,
            idempotencyKey: 'provider:prompt:prompt-run-1',
            receiptIdentity: 'provider:prompt:prompt-run-1',
        },
    })),
    settle: vi.fn(),
    recordAgentProviderUsage: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRevision: () => 'revision-1' }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    parseVersionedCommandBatchEnvelope: vi.fn(),
}));
vi.mock('../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        create: mocks.create,
        get: mocks.get,
        reserveBudget: mocks.reserveBudget,
        transitionPhase: mocks.transitionPhase,
        recordPlan: vi.fn(),
        recordBatch: vi.fn(),
    },
}));
vi.mock('../cancelAgentRun', () => ({ agentRunCancellation: { cancel: vi.fn() } }));
vi.mock('../agentRunWorkLease', () => ({ agentRunWorkLease: { claim: mocks.claim, settle: mocks.settle } }));
vi.mock('../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../recordAgentProviderUsage', () => ({ recordAgentProviderUsage: mocks.recordAgentProviderUsage }));

import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

describe('submitAdmittedPromptRequest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.planPromptActions.mockImplementation(async (input) => {
            input.onProviderResult?.({
                provider: 'cloud',
                model: 'model-1',
                correlationId: 'provider-attempt-1',
                status: 'complete',
                usage: { inputTokens: 11, outputTokens: 13, provenance: 'provider-reported' },
                failure: null,
                partialOutputDisposition: 'none',
                remoteDisclosure: null,
            });
            return {
                context: { tracks: [] },
                result: { actions: [], rawText: 'Arrange this project', requiresConfirmation: false },
                projectRevision: 'revision-1',
            };
        });
    });

    it('admits the run and provider budget before prompt-bar planning begins', async () => {
        await submitAdmittedPromptRequest({ prompt: 'Arrange this project', source: 'prompt-bar' });

        expect(mocks.create).toHaveBeenCalledWith(
            expect.objectContaining({ request: 'Arrange this project', mode: 'apply' })
        );
        expect(mocks.transitionPhase).toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'planning', revision: 'revision-1' })
        );
        const planningInput = mocks.planPromptActions.mock.calls[0]?.[0];
        expect(planningInput).toEqual(
            expect.objectContaining({ prompt: 'Arrange this project', streamIdentity: expect.any(Object) })
        );
        const admission = planningInput.onProviderAttempt({
            backend: 'cloud',
            correlationId: 'provider-attempt-1',
            estimatedTotalTokens: 42,
            estimate: { method: 'request-ceiling' },
        });
        expect(admission).toEqual({ status: 'admitted' });
        expect(mocks.reserveBudget).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'remoteTokens', estimate: 42 })
        );
        expect(mocks.recordAgentProviderUsage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ correlationId: 'provider-attempt-1' }),
            'provider-attempt-1',
            { terminal: true }
        );
        expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ workId: 'provider-planning' }));
        expect(mocks.settle).toHaveBeenCalledWith(
            expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' })
        );
    });
});
