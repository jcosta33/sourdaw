import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import {
    AGENT_RUN_CANCELLATION_PERSISTENCE_WARNING,
    AGENT_RUN_COMPLETION_PERSISTENCE_WARNING,
    AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
    AGENT_RUN_STALE_FAILURE_WARNING,
} from '../agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

const mocks = vi.hoisted(() => ({
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() => 'revision-1'),
    compileAgentActionExecution: vi.fn(),
    describePlannedAction: vi.fn(() => 'Toggle playback'),
    executePromptActionGroup: vi.fn(),
    getProjectContext: vi.fn(() => ({ tracks: [] })),
    notifyAiChange: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    planPromptActions: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    settlePendingProjectWritesAndCaptureRevision: mocks.settlePendingProjectWritesAndCaptureRevision,
    createCrdtDoc: vi.fn(),
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    preserveBranchStateForSession: vi.fn(),
    removeCrdtDoc: vi.fn(),
    replaceBranchState: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    restoreBranchStateAfterSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
}));
vi.mock('../compileAgentActionExecution', () => ({
    compileAgentActionExecution: mocks.compileAgentActionExecution,
}));
vi.mock('../describePlannedAction', () => ({ describePlannedAction: mocks.describePlannedAction }));
vi.mock('../executePromptActionGroup', () => ({ executePromptActionGroup: mocks.executePromptActionGroup }));
vi.mock('../getProjectContext', () => ({ getProjectContext: mocks.getProjectContext }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));

const RUN_ID = 'agent-run-00000000-0000-0000-0000-000000000001';
const STALE_PROVIDER_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. No completed artifact is claimed, and the terminal run was not reopened.';
const action = { type: 'togglePlayback' } as const;
const authority = {
    projectId: 'revision-1',
    baseRevision: 'revision-1',
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    grants: {
        allowedOperationPrefixes: ['togglePlayback'],
        create: false,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: false,
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    },
    budgets: {
        maxCommands: 1,
        maxCreatedTracks: 0,
        maxDeletedObjects: 0,
        maxAffectedTracks: 0,
        maxAffectedClips: 0,
        maxAutomationPoints: 0,
        maxImportedAssets: 0,
        maxRenderJobs: 0,
    },
};
const commandBatch = { serialized: 'serialized-batch-1', authority };
const approval = { actorId: 'artist-1', fingerprint: 'approval-1' };
const compiled = {
    commandBatch,
    commandEnvelopes: ['command-1'],
    agentApproval: approval,
    interactionMode: 'apply',
    requiresConfirmation: true,
};

function providerResult(input: {
    correlationId: string;
    provider: 'openai-compatible' | 'webllm';
    status: 'complete' | 'failed';
    failureCode?: string;
}) {
    return {
        provider: input.provider,
        model: input.provider === 'webllm' ? 'local-model' : 'hosted-model',
        correlationId: input.correlationId,
        status: input.status,
        usage: { inputTokens: 11, outputTokens: 13, provenance: 'provider-reported' as const },
        failure:
            input.status === 'failed'
                ? { code: input.failureCode ?? 'provider-failed', retryable: true, safeMessage: 'Provider failed.' }
                : null,
        partialOutputDisposition: 'none' as const,
        remoteDisclosure: null,
        output: { text: '', toolCalls: [] },
    };
}

describe('submitAdmittedPromptRequest', () => {
    let randomUuid: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        agentRunLifecycle.clear();
        randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
        mocks.settlePendingProjectWritesAndCaptureRevision.mockReturnValue('revision-1');
        mocks.compileAgentActionExecution.mockReturnValue(compiled);
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: RUN_ID,
                batchId: 'batch-1',
                idempotencyKey: 'batch-key-1',
                commands: [{ commandId: 'command-1' }],
            },
        });
        mocks.executePromptActionGroup.mockResolvedValue({ status: 'committed' });
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: { actions: [], rawText: 'Arrange this project', requiresConfirmation: false },
            projectRevision: 'revision-1',
        });
    });

    afterEach(() => {
        randomUuid.mockRestore();
        vi.restoreAllMocks();
    });

    it('claims provider work before planning and records real intermediate and final budget usage', async () => {
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        mocks.planPromptActions.mockImplementation(async (input) => {
            expect(
                input.onProviderAttempt?.({
                    backend: 'cloud',
                    provider: 'openai-compatible',
                    correlationId: 'provider-attempt-1',
                    estimatedTotalTokens: 42,
                    estimate: {
                        method: 'compiled-provider-request-utf8-byte-token-ceiling-v1',
                        inputTokenCeiling: 20,
                        outputTokenCeiling: 22,
                        totalTokenCeiling: 42,
                    },
                })
            ).toEqual({ status: 'admitted' });
            input.onProviderResult?.(
                providerResult({
                    correlationId: 'provider-attempt-1',
                    provider: 'openai-compatible',
                    status: 'failed',
                    failureCode: 'hosted-down',
                })
            );
            expect(
                input.onProviderAttempt?.({
                    backend: 'webllm',
                    provider: 'webllm',
                    correlationId: 'provider-attempt-2',
                    estimatedTotalTokens: 30,
                    estimate: {
                        method: 'compiled-provider-request-utf8-byte-token-ceiling-v1',
                        inputTokenCeiling: 20,
                        outputTokenCeiling: 10,
                        totalTokenCeiling: 30,
                    },
                })
            ).toEqual({ status: 'admitted' });
            input.onProviderResult?.(
                providerResult({
                    correlationId: 'provider-attempt-2',
                    provider: 'webllm',
                    status: 'complete',
                })
            );
            return {
                context: { tracks: [] },
                result: { actions: [], rawText: 'Arrange this project', requiresConfirmation: false },
                projectRevision: 'revision-1',
            };
        });

        await submitAdmittedPromptRequest({ prompt: 'Arrange this project', source: 'prompt-bar' });

        expect(claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.planPromptActions.mock.invocationCallOrder[0]!);
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'completed',
            budgetAttempts: [
                { attemptId: 'provider-attempt-1', actual: 24, final: true },
                { attemptId: 'provider-attempt-2', actual: 24, final: true },
            ],
            providerUsage: [
                { correlationId: 'provider-attempt-1', fallbackReason: 'hosted-down' },
                { correlationId: 'provider-attempt-2', fallbackReason: null },
            ],
            workLeases: [{ workId: 'provider-planning', terminalState: 'completed' }],
        });
    });

    it('terminalizes a provider-work claim rejection and reports it to the user', async () => {
        vi.spyOn(agentRunWorkLease, 'claim').mockReturnValue({ status: 'already-claimed' });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Arrange this project', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'rejected', runId: RUN_ID });

        expect(mocks.planPromptActions).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({ phase: 'failed', workLeases: [] });
        expect(mocks.notifyAiChange).toHaveBeenCalledWith(
            'Command not executed: prompt provider work could not be claimed (already-claimed).',
            []
        );
    });

    it('reports the real no-match terminal notification from the admitted use case', async () => {
        await expect(
            submitAdmittedPromptRequest({ prompt: 'Arrange this project', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'no-op', runId: RUN_ID });

        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({ phase: 'completed' });
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            'No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.',
            []
        );
    });

    it('reports the real planning-rejection notification from the admitted use case', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [],
                rawText: 'Save the project',
                requiresConfirmation: false,
                rejectionReason: 'Action saveProject cannot be executed by AI because it does not report completion.',
            },
            projectRevision: 'revision-1',
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Save the project', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'rejected', runId: RUN_ID });

        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({ phase: 'failed' });
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            'Command not executed: Action saveProject cannot be executed by AI because it does not report completion.',
            []
        );
    });

    it('asks the provider questions back to the user instead of the generic no-match advice', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [],
                rawText: 'Make it sound better',
                requiresConfirmation: false,
                planningOutcome: {
                    kind: 'clarify',
                    reason: 'The request does not say which part of the mix to change.',
                    questions: ['Which tracks should change?', 'Louder or brighter?'],
                },
            },
            projectRevision: 'revision-1',
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Make it sound better', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'no-op', runId: RUN_ID });

        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            'The request does not say which part of the mix to change. 1. Which tracks should change? 2. Louder or brighter?',
            []
        );
    });

    it('says a searched-for capability is unsupported instead of the generic no-match advice', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [],
                rawText: 'Master this for vinyl',
                requiresConfirmation: false,
                planningOutcome: {
                    kind: 'unsupported',
                    reason: 'No command in this project masters for vinyl.',
                    searchedIntents: ['master for vinyl'],
                },
            },
            projectRevision: 'revision-1',
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Master this for vinyl', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'no-op', runId: RUN_ID });

        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            'Not supported: No command in this project masters for vinyl. Searched: master for vinyl',
            []
        );
    });

    it('does not record or expose a plan after cancellation wins provider settlement', async () => {
        const controller = new AbortController();
        mocks.planPromptActions.mockImplementation(async (input) => {
            expect(
                input.onProviderAttempt?.({
                    backend: 'cloud',
                    provider: 'openai-compatible',
                    correlationId: 'provider-attempt-1',
                    estimatedTotalTokens: 42,
                    estimate: {
                        method: 'compiled-provider-request-utf8-byte-token-ceiling-v1',
                        inputTokenCeiling: 20,
                        outputTokenCeiling: 22,
                        totalTokenCeiling: 42,
                    },
                })
            ).toEqual({ status: 'admitted' });
            input.onProviderResult?.(
                providerResult({
                    correlationId: 'provider-attempt-1',
                    provider: 'openai-compatible',
                    status: 'complete',
                })
            );
            controller.abort();
            return {
                context: { tracks: [] },
                result: { actions: [action], rawText: 'Play', requiresConfirmation: true },
                projectRevision: 'revision-1',
            };
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar', signal: controller.signal })
        ).resolves.toEqual({ status: 'rejected', runId: RUN_ID });

        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'cancelled',
            plan: null,
            batches: [],
            cancellation: { generation: 1 },
            workLeases: [{ workId: 'provider-planning', terminalState: 'cancelled' }],
        });
    });

    it('reuses one failed cancellation attempt after provider planning aborts', async () => {
        const controller = new AbortController();
        const cancellationError = new Error('Cancellation storage unavailable');
        const cancel = vi.spyOn(agentRunCancellation, 'cancel').mockRejectedValue(cancellationError);
        const settle = vi.spyOn(agentRunWorkLease, 'settle');
        mocks.planPromptActions.mockImplementation(async () => {
            controller.abort();
            return {
                context: { tracks: [] },
                result: { actions: [action], rawText: 'Play', requiresConfirmation: true },
                projectRevision: 'revision-1',
            };
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar', signal: controller.signal })
        ).resolves.toEqual({ status: 'rejected', runId: RUN_ID });

        expect(cancel).toHaveBeenCalledExactlyOnceWith({
            runId: RUN_ID,
            reason: 'Prompt request cancelled by the user.',
        });
        expect(settle).not.toHaveBeenCalled();
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'planning',
            plan: null,
            batches: [],
            workLeases: [{ workId: 'provider-planning', terminalState: null }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(AGENT_RUN_CANCELLATION_PERSISTENCE_WARNING, []);
    });

    it.each([
        { label: 'stale', settle: () => ({ status: 'stale' as const }), warning: STALE_PROVIDER_COMPLETION_WARNING },
        {
            label: 'persistence fails',
            settle: () => {
                throw new Error('Provider lease storage unavailable');
            },
            warning: AGENT_RUN_COMPLETION_PERSISTENCE_WARNING,
        },
    ])(
        'does not materialize a prompt plan when provider completion settlement is $label',
        async ({ settle, warning }) => {
            mocks.planPromptActions.mockResolvedValue({
                context: { tracks: [] },
                result: { actions: [action], rawText: 'Play', requiresConfirmation: true },
                projectRevision: 'revision-1',
            });
            vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(settle);

            await expect(submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' })).resolves.toEqual({
                status: 'rejected',
                runId: RUN_ID,
            });

            expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
            expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
                phase: 'planning',
                plan: null,
                batches: [],
                workLeases: [{ workId: 'provider-planning', terminalState: null }],
            });
            expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
                `Prompt plan was not materialized: ${warning}`,
                []
            );
        }
    );

    it.each([
        { label: 'stale', settle: () => ({ status: 'stale' as const }), warning: AGENT_RUN_STALE_FAILURE_WARNING },
        {
            label: 'persistence fails',
            settle: () => {
                throw new Error('Provider lease storage unavailable');
            },
            warning: AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
        },
    ])('preserves the provider failure when failed settlement is $label', async ({ settle, warning }) => {
        const providerError = new Error('Provider planning failed');
        mocks.planPromptActions.mockRejectedValue(providerError);
        vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(settle);

        await expect(submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' })).rejects.toBe(providerError);

        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'planning',
            plan: null,
            batches: [],
            workLeases: [{ workId: 'provider-planning', terminalState: null }],
        });
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            `Command not executed: Provider planning failed. ${warning}`,
            []
        );
    });

    it('settles a clean provider planning rejection as failed while preserving the original error', async () => {
        const providerError = new Error('Provider planning failed cleanly');
        mocks.planPromptActions.mockRejectedValue(providerError);
        const settle = vi.spyOn(agentRunWorkLease, 'settle');

        await expect(submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' })).rejects.toBe(providerError);

        expect(settle).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ workId: 'provider-planning', terminalState: 'failed' })
        );
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            workLeases: [{ workId: 'provider-planning', terminalState: 'failed' }],
        });
    });

    it('terminalizes a compiler failure after clean provider settlement without settling the provider twice', async () => {
        const compilerError = new Error('Prompt command compiler failed');
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: { actions: [action], rawText: 'Play', requiresConfirmation: true },
            projectRevision: 'revision-1',
        });
        mocks.compileAgentActionExecution.mockImplementation(() => {
            throw compilerError;
        });
        const settle = vi.spyOn(agentRunWorkLease, 'settle');

        await expect(submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' })).rejects.toBe(compilerError);

        expect(settle).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'failed',
            plan: null,
            batches: [],
            workLeases: [{ workId: 'provider-planning', terminalState: 'completed' }],
        });
    });

    it('preserves a compiler failure when terminal phase persistence fails after provider settlement', async () => {
        const compilerError = new Error('Prompt command compiler failed');
        const stems = [{ audioBufferId: 'prepared-stem-compiler', assetLeaseId: 'asset-lease-compiler' }];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: { actions: [stemAction], rawText: 'Import stems', requiresConfirmation: true },
            projectRevision: 'revision-1',
        });
        mocks.compileAgentActionExecution.mockImplementation(() => {
            throw compilerError;
        });
        const transitionPhase = agentRunLifecycle.transitionPhase;
        vi.spyOn(agentRunLifecycle, 'transitionPhase').mockImplementation((input) => {
            if (input.phase === 'failed') {
                throw new Error('Phase storage unavailable');
            }
            return transitionPhase(input);
        });
        const discard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue();

        await expect(submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' })).rejects.toBe(compilerError);

        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            `Command not executed: Prompt command compiler failed. ${AGENT_RUN_FAILURE_PERSISTENCE_WARNING}`,
            []
        );
        expect(discard).toHaveBeenCalledExactlyOnceWith({ runId: RUN_ID, stems });
    });

    it('releases plan-owned stem resources when provider completion cannot be settled', async () => {
        const stems = [{ audioBufferId: 'prepared-stem-1', assetLeaseId: 'asset-lease-1' }];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: { actions: [stemAction], rawText: 'Import stems', requiresConfirmation: true },
            projectRevision: 'revision-1',
        });
        vi.spyOn(agentRunWorkLease, 'settle').mockReturnValueOnce({ status: 'stale' });
        const discard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue();

        await expect(submitAdmittedPromptRequest({ prompt: 'Import stems', source: 'prompt-bar' })).resolves.toEqual({
            status: 'rejected',
            runId: RUN_ID,
        });

        expect(discard).toHaveBeenCalledExactlyOnceWith({ runId: RUN_ID, stems });
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
    });

    it('keeps plan-owned stems until execution acquires cleanup and then avoids a second cleanup', async () => {
        const stems = [{ audioBufferId: 'prepared-stem-1', assetLeaseId: 'asset-lease-1' }];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        const executorError = new Error('Command executor failed after resource acquisition');
        mocks.compileAgentActionExecution.mockReturnValue({ ...compiled, requiresConfirmation: false });
        mocks.executePromptActionGroup.mockImplementation(async (executionInput) => {
            executionInput.onResourceOwnershipAcquired?.();
            throw executorError;
        });
        const discard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue();

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Import stems', source: 'prompt-bar', actions: [stemAction] })
        ).rejects.toBe(executorError);

        expect(discard).not.toHaveBeenCalled();
    });

    it('cleans plan-owned stems when execution cannot acquire cleanup responsibility', async () => {
        const stems = [{ audioBufferId: 'prepared-stem-1', assetLeaseId: 'asset-lease-1' }];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        const acquisitionError = new Error('Command resource acquisition failed');
        mocks.compileAgentActionExecution.mockReturnValue({ ...compiled, requiresConfirmation: false });
        mocks.executePromptActionGroup.mockRejectedValue(acquisitionError);
        const discard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue();

        await expect(
            submitAdmittedPromptRequest({ prompt: 'Import stems', source: 'prompt-bar', actions: [stemAction] })
        ).rejects.toBe(acquisitionError);

        expect(discard).toHaveBeenCalledExactlyOnceWith({ runId: RUN_ID, stems });
    });

    it('deduplicates fulfilled preview cancellation', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected an approval preview, received ${result.status}`);
        }
        const cancel = vi.spyOn(agentRunCancellation, 'cancel').mockResolvedValue({
            status: 'cancelled',
            phase: 'cancelled',
            cancelledWorkIds: [],
            cleanupPendingAssetIds: [],
            releasedAssetIds: [],
        });

        await result.preview.cancel();
        await result.preview.cancel();

        expect(cancel).toHaveBeenCalledOnce();
    });

    it('retries persistence of a live terminal preview cancellation without recancelling the run', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected an approval preview, received ${result.status}`);
        }
        const durableBefore = window.localStorage.getItem('sourdaw-agent-runs');
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('Cancellation storage unavailable');
        });

        await expect(result.preview.cancel()).rejects.toThrow('Agent run state could not be persisted locally');
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('cancelled');
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(durableBefore);
        await result.preview.cancel();

        expect(setItem).toHaveBeenCalledTimes(2);
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('cancelled');
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(AGENT_RUN_CANCELLATION_PERSISTENCE_WARNING, []);
        setItem.mockRestore();
    });

    it('resumes pending temporary-asset cleanup after retrying cancellation persistence', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected an approval preview, received ${result.status}`);
        }
        const cleanup = vi.fn(() => {
            expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('cancelled');
        });
        agentRunLifecycle.registerTemporaryAsset({
            runId: RUN_ID,
            assetId: 'preview-cleanup-retry',
            kind: 'import',
            cleanupOwner: 'preview-cleanup-owner',
        });
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: RUN_ID,
            assetId: 'preview-cleanup-retry',
            cleanupOwner: 'preview-cleanup-owner',
            cleanup,
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('Cancellation storage unavailable');
        });

        await expect(result.preview.cancel()).rejects.toThrow('Agent run state could not be persisted locally');
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'preview-cleanup-retry', status: 'cleanup-pending' }),
        ]);

        await result.preview.cancel();

        expect(cleanup).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).not.toContainEqual(
            expect.objectContaining({ assetId: 'preview-cleanup-retry', status: 'cleanup-pending' })
        );
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(AGENT_RUN_CANCELLATION_PERSISTENCE_WARNING, []);
        setItem.mockRestore();
    });

    it('retries a synchronous temporary-asset cleanup failure without claiming a persistence warning', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected an approval preview, received ${result.status}`);
        }
        const cleanup = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('temporary cleanup failed once');
            })
            .mockImplementationOnce(() => undefined);
        agentRunLifecycle.registerTemporaryAsset({
            runId: RUN_ID,
            assetId: 'preview-sync-cleanup-retry',
            kind: 'import',
            cleanupOwner: 'preview-sync-cleanup-owner',
        });
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: RUN_ID,
            assetId: 'preview-sync-cleanup-retry',
            cleanupOwner: 'preview-sync-cleanup-owner',
            cleanup,
        });

        await result.preview.cancel();
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'preview-sync-cleanup-retry', status: 'cleanup-pending' }),
        ]);

        await result.preview.cancel();

        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).not.toContainEqual(
            expect.objectContaining({ assetId: 'preview-sync-cleanup-retry', status: 'cleanup-pending' })
        );
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
    });

    it('retries an asynchronous temporary-asset cleanup rejection after its fire-and-forget failure settles', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected an approval preview, received ${result.status}`);
        }
        let rejectCleanup: (reason?: unknown) => void = () => undefined;
        const cleanup = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        rejectCleanup = reject;
                    })
            )
            .mockImplementationOnce(() => undefined);
        agentRunLifecycle.registerTemporaryAsset({
            runId: RUN_ID,
            assetId: 'preview-async-cleanup-retry',
            kind: 'import',
            cleanupOwner: 'preview-async-cleanup-owner',
        });
        agentRunCancellation.registerTemporaryAssetCleanup({
            runId: RUN_ID,
            assetId: 'preview-async-cleanup-retry',
            cleanupOwner: 'preview-async-cleanup-owner',
            cleanup,
        });

        await result.preview.cancel();
        rejectCleanup(new Error('temporary cleanup rejected once'));
        await Promise.resolve();
        await Promise.resolve();
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'preview-async-cleanup-retry', status: 'cleanup-pending' }),
        ]);

        await result.preview.cancel();

        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).not.toContainEqual(
            expect.objectContaining({ assetId: 'preview-async-cleanup-retry', status: 'cleanup-pending' })
        );
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
    });

    it('preserves compiler dependencies and batch-local bindings at the admitted compilation boundary', async () => {
        const actions = [
            { type: 'createBus', payload: { name: 'Drum Bus', busId: 'bus-ai-drum' } },
            {
                type: 'setTrackGain',
                payload: { trackId: 'bus-ai-drum', gain: 0.8, expectedGain: 1 },
            },
        ] satisfies AppAction[];
        const actionCommandGraph = {
            dependenciesByActionIndex: [[], [0]],
            batchLocalBindings: [{ bindingId: '$drum-bus', producerActionIndex: 0, producerArgument: 'busId' }],
        } as const;
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions,
                actionCommandGraph,
                rawText: 'Create a Drum Bus, then set its gain to 0.8.',
                requiresConfirmation: true,
            },
            projectRevision: 'revision-1',
        });

        await submitAdmittedPromptRequest({
            prompt: 'Create a Drum Bus, then set its gain to 0.8.',
            source: 'prompt-bar',
        });

        expect(mocks.compileAgentActionExecution).toHaveBeenCalledWith(
            expect.objectContaining({ actions, actionCommandGraph })
        );
    });

    it('forwards the exact compiled approval and command batch from submit to confirmation', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected an approval preview, received ${result.status}`);
        }

        await result.preview.confirm();

        expect(mocks.executePromptActionGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: RUN_ID,
                successVerb: 'Confirmed',
                prepared: compiled,
            })
        );
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'waiting-for-approval',
            batches: [{ batchId: 'batch-1', status: 'waiting-for-approval' }],
        });
    });

    it.each(['committed', 'executed', 'failed', 'cancelled', 'ambiguous', 'no-op'] as const)(
        'returns the exact %s command outcome through the admitted submission boundary',
        async (status) => {
            mocks.compileAgentActionExecution.mockReturnValue({
                ...compiled,
                agentApproval: null,
                requiresConfirmation: false,
            });
            mocks.executePromptActionGroup.mockResolvedValue({ status });

            await expect(
                submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar', actions: [action] })
            ).resolves.toEqual({ status, runId: RUN_ID });
        }
    );
});
