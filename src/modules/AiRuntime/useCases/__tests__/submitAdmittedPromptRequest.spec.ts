import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    captureProjectIdentity,
    captureProjectMutationAuthorization,
    captureProjectRootIdentity,
    mutateCrdtDoc,
    persistCrdtProject,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type ProjectContext } from '../../models/ProjectContext';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { preparedStemImportCleanup } from '../agentReference/discardPreparedStemImportResources';
import { readExplicitProtections } from '../agentReference/readExplicitProtections';
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
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { groundCompiledCommandBatch } from '../groundCompiledCommandBatch';
import { readChatThreadContext } from '../readChatThreadContext';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

const mocks = vi.hoisted(() => ({
    stopMeasuredPreviewAudition: vi.fn(async () => ({ status: 'idle' })),
    settlePendingProjectWritesAndCaptureRevision: vi.fn(() => 'revision-1'),
    compileAgentActionExecution: vi.fn(),
    describePlannedAction: vi.fn(() => 'Toggle playback'),
    executePromptActionGroup: vi.fn(),
    getProjectContext: vi.fn<() => Partial<ProjectContext>>(() => ({ tracks: [], selectedClipIds: [] })),
    notifyAiAnswer: vi.fn(),
    notifyAiChange: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    planPromptActions: vi.fn(),
    parsePromptToActions: vi.fn(),
}));

vi.mock('../stopMeasuredPreviewAudition', () => ({ stopMeasuredPreviewAudition: mocks.stopMeasuredPreviewAudition }));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    commandSourcePublicationMatches: vi.fn<
        typeof import('#/modules/CrdtDocument/useCases').commandSourcePublicationMatches
    >(() => false),
    stageCommandSourcePublication: vi.fn<
        typeof import('#/modules/CrdtDocument/useCases').stageCommandSourcePublication
    >(() => () => undefined),
    captureActiveBranchReference: vi.fn(),
    captureDurableDocumentWitness: vi.fn(),
    captureProjectMutationAuthorization: vi.fn(() => () => true),
    captureProjectIdentity: vi.fn(() => 'revision-1'),
    captureProjectRevision: vi.fn(() => 'revision-1'),
    captureProjectRootIdentity: vi.fn(() => 'root-identity'),
    compactProject: vi.fn(),
    hasForeignPendingProjectWrites: vi.fn(() => false),
    settlePendingProjectWritesAndCaptureRevision: mocks.settlePendingProjectWritesAndCaptureRevision,
    createCrdtDoc: vi.fn(),
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    loadCrdtProject: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    beginBranchSession: vi.fn(),
    projectCrdtToStores: vi.fn(),
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn(() => true),
    removeCrdtDoc: vi.fn(),
    projectBranchSession: vi.fn(),
    readOwnedProjectPublications: vi.fn(() => []),
    replaceCrdtDoc: vi.fn(),
    replaceCrdtDocInLineage: vi.fn(),
    resetCrdtProject: vi.fn(),
    endBranchSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
    startCrdtAutoSave: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
    describeCommandBatchRecovery: vi.fn(() => ({ status: 'described', recoveryByCommandId: {} })),
    buildSemanticProjectDiff: vi.fn(() => ({ intentGroups: [], destructiveChanges: [] })),
}));
vi.mock('../compileAgentActionExecution', () => ({
    compileAgentActionExecution: mocks.compileAgentActionExecution,
}));
vi.mock('../describePlannedAction', () => ({ describePlannedAction: mocks.describePlannedAction }));
vi.mock('../executePromptActionGroup', () => ({ executePromptActionGroup: mocks.executePromptActionGroup }));
vi.mock('../getProjectContext', () => ({ getProjectContext: mocks.getProjectContext }));
vi.mock('../notifyAiAnswer', () => ({ notifyAiAnswer: mocks.notifyAiAnswer }));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: mocks.notifyAiChange }));
vi.mock('../planPromptActions', () => ({ planPromptActions: mocks.planPromptActions }));
vi.mock('../parsePromptToActions', () => ({ parsePromptToActions: mocks.parsePromptToActions }));

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
const approval = {
    policy: { risk: 'bounded-reversible', decision: 'confirm', reasons: [], requiredTrustMode: 'apply-reversible' },
    consequences: {},
    actorId: 'artist-1',
    fingerprint: 'approval-1',
};
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
        clearPendingActionConfirmations();
        clearChatMessages();
        agentRunLifecycle.clear();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
        randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
        mocks.settlePendingProjectWritesAndCaptureRevision.mockReturnValue('revision-1');
        mocks.getProjectContext.mockReturnValue({ tracks: [], selectedClipIds: [] });
        vi.mocked(captureProjectMutationAuthorization).mockReturnValue(() => true);
        vi.mocked(captureProjectRootIdentity).mockReturnValue('root-identity');
        vi.mocked(captureProjectIdentity).mockReturnValue('revision-1');
        mocks.parsePromptToActions.mockResolvedValue({
            actions: [action],
            rawText: 'Play',
            requiresConfirmation: false,
            planningOutcome: { kind: 'proposal' },
        });
        mocks.compileAgentActionExecution.mockReturnValue(compiled);
        mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
            status: 'valid',
            envelope: {
                runId: RUN_ID,
                batchId: 'batch-1',
                idempotencyKey: 'batch-key-1',
                scope: authority.scope,
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

    it('passes a selected preset to the deterministic parser without provider work or a second snapshot', async () => {
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        const reserve = vi.spyOn(agentRunLifecycle, 'reserveBudget');
        const expectedContext = {
            selectedTrackId: undefined,
            selectedClipId: undefined,
            selectedClipType: undefined,
            trackCount: 0,
        };
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'preset',
            preset: { id: 'play', expectedContext },
        });
        expect(result).toEqual({ status: 'awaiting-approval', runId: RUN_ID, confirmationId: expect.any(String) });
        expect(mocks.parsePromptToActions).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                prompt: 'Play',
                context: mocks.getProjectContext.mock.results[0]?.value,
                projectRevision: 'revision-1',
                preset: { id: 'play', expectedContext },
                providerPlanning: 'disabled',
            })
        );
        expect(mocks.planPromptActions).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
    });

    it('rejects a selected preset mixed with caller actions before parsing or provider work', async () => {
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        const input = {
            prompt: 'Play',
            source: 'preset',
            preset: { id: 'play', expectedContext: {} },
            actions: [action],
        };
        expect(await Reflect.apply(submitAdmittedPromptRequest, undefined, [input])).toEqual({
            status: 'rejected',
            runId: RUN_ID,
        });
        expect(mocks.parsePromptToActions).not.toHaveBeenCalled();
        expect(mocks.planPromptActions).not.toHaveBeenCalled();
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('failed');
    });

    it('does not parse or compile a pre-aborted selected preset', async () => {
        const controller = new AbortController();
        controller.abort();
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'preset',
            signal: controller.signal,
            preset: {
                id: 'play',
                expectedContext: {
                    selectedTrackId: undefined,
                    selectedClipId: undefined,
                    selectedClipType: undefined,
                    trackCount: 0,
                },
            },
        });
        expect(result.status).toBe('rejected');
        expect(mocks.parsePromptToActions).not.toHaveBeenCalled();
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('cancelled');
    });

    it('cancels a selected preset while its admitted parser result is pending without compilation', async () => {
        const controller = new AbortController();
        let finish: () => void = () => {
            throw new Error('Expected parser entry');
        };
        mocks.parsePromptToActions.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = () =>
                        resolve({
                            actions: [action],
                            rawText: 'Play',
                            requiresConfirmation: false,
                            planningOutcome: { kind: 'proposal' },
                        });
                })
        );
        const pending = submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'preset',
            signal: controller.signal,
            preset: {
                id: 'play',
                expectedContext: {
                    selectedTrackId: undefined,
                    selectedClipId: undefined,
                    selectedClipType: undefined,
                    trackCount: 0,
                },
            },
        });
        expect(mocks.parsePromptToActions).toHaveBeenCalledOnce();
        controller.abort();
        finish();
        expect((await pending).status).toBe('rejected');
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('cancelled');
    });

    it.each(['revision', 'root', 'mutation', 'selection'])(
        'rejects selected preset %s drift across admission before compilation',
        async (drift) => {
            let mutationCurrent = true;
            vi.mocked(captureProjectMutationAuthorization).mockReturnValue(() => mutationCurrent);
            mocks.parsePromptToActions.mockImplementationOnce(async () => {
                if (drift === 'revision') {
                    mocks.settlePendingProjectWritesAndCaptureRevision.mockReturnValue('revision-2');
                }
                if (drift === 'root') {
                    vi.mocked(captureProjectRootIdentity).mockReturnValue('replaced-root');
                }
                if (drift === 'mutation') {
                    mutationCurrent = false;
                }
                if (drift === 'selection') {
                    mocks.getProjectContext.mockReturnValue({
                        tracks: [],
                        selectedTrackId: 'other-track',
                        selectedClipIds: [],
                    });
                }
                return {
                    actions: [action],
                    rawText: 'Play',
                    requiresConfirmation: false,
                    planningOutcome: { kind: 'proposal' },
                };
            });
            await expect(
                submitAdmittedPromptRequest({
                    prompt: 'Play',
                    source: 'preset',
                    preset: {
                        id: 'play',
                        expectedContext: {
                            selectedTrackId: undefined,
                            selectedClipId: undefined,
                            selectedClipType: undefined,
                            trackCount: 0,
                        },
                    },
                })
            ).rejects.toThrow('project');
            expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('failed');
        }
    );

    it('claims provider work before planning and records real intermediate and final budget usage', async () => {
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        mocks.planPromptActions.mockImplementation(async (input) => {
            expect(mocks.stopMeasuredPreviewAudition).toHaveBeenCalledTimes(1);
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

    it('shows an answer outcome as its text, completes the run, and creates no confirmation', async () => {
        vi.mocked(captureProjectIdentity).mockReturnValue('project-a');
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [],
                rawText: 'How loud is the mix?',
                requiresConfirmation: false,
                planningOutcome: {
                    kind: 'answer',
                    text: 'The mix peaks at -1.2 dBFS.',
                    evidence: [{ callId: 'call-1', toolName: 'analysis.measure', summary: 'Peak -1.2 dBFS.' }],
                },
            },
            projectRevision: 'revision-1',
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'How loud is the mix?', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'no-op', runId: RUN_ID });

        expect(mocks.notifyAiAnswer).toHaveBeenCalledExactlyOnceWith({
            prompt: 'How loud is the mix?',
            text: 'The mix peaks at -1.2 dBFS.',
            evidence: [{ callId: 'call-1', toolName: 'analysis.measure', summary: 'Peak -1.2 dBFS.' }],
            projectIdentity: 'project-a',
            projectRevision: 'revision-1',
        });
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({ phase: 'completed' });
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
    });

    it('reads an answer before the actions, so a batch beside an answer never runs', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [action],
                rawText: 'How loud is the mix?',
                requiresConfirmation: false,
                planningOutcome: { kind: 'answer', text: 'The mix peaks at -1.2 dBFS.', evidence: [] },
            },
            projectRevision: 'revision-1',
        });

        await expect(
            submitAdmittedPromptRequest({ prompt: 'How loud is the mix?', source: 'prompt-bar' })
        ).resolves.toEqual({ status: 'no-op', runId: RUN_ID });

        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
        expect(mocks.notifyAiAnswer).toHaveBeenCalledExactlyOnceWith({
            prompt: 'How loud is the mix?',
            text: 'The mix peaks at -1.2 dBFS.',
            evidence: [],
            projectIdentity: 'revision-1',
            projectRevision: 'revision-1',
        });
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({ phase: 'completed' });
    });

    it('never shows an empty answer as a blank notice', async () => {
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: {
                actions: [],
                rawText: 'How loud is the mix?',
                requiresConfirmation: false,
                planningOutcome: { kind: 'answer', text: '  ', evidence: [] },
            },
            projectRevision: 'revision-1',
        });

        await submitAdmittedPromptRequest({ prompt: 'How loud is the mix?', source: 'prompt-bar' });

        expect(mocks.notifyAiAnswer).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            'No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.',
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

    it.each([64, 3 * 1024 * 1024 * 1024])(
        'transfers stem cleanup exactly once for retained or refused admission (%s bytes)',
        async (sourceBytes) => {
            const stems = [
                {
                    audioBufferId: 'prepared-stem',
                    assetLeaseId: 'asset-lease',
                    assetHash: 'asset-hash',
                    sourceBytes,
                    decodedBytes: 0,
                },
            ];
            const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
            const cleanup = vi.spyOn(preparedStemImportCleanup, 'discard').mockResolvedValue(undefined);
            const oldDiscard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue(undefined);
            const release = vi.spyOn(preparedStemImportResources, 'release');
            const result = await submitAdmittedPromptRequest({
                prompt: 'Import prepared stems',
                source: 'preset',
                actions: [stemAction],
                requiresConfirmation: true,
            });
            expect(release).toHaveBeenCalledExactlyOnceWith({ runId: RUN_ID, stems });
            if (sourceBytes === 64) {
                expect(result.status).toBe('awaiting-approval');
                if (result.status !== 'awaiting-approval') {
                    throw new Error(result.status);
                }
                expect(cleanup).not.toHaveBeenCalled();
                await cancelPendingChatActions({ confirmationId: result.confirmationId });
            } else {
                expect(result.status).toBe('rejected');
            }
            await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
            expect(oldDiscard).not.toHaveBeenCalled();
        }
    );

    it('keeps the actual confirmation and lease retryable when retained-resource cleanup fails', async () => {
        const stems = [
            {
                audioBufferId: 'retry-stem',
                assetLeaseId: 'asset-lease',
                assetHash: 'asset-hash',
                sourceBytes: 64,
                decodedBytes: 0,
            },
        ];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        const cleanup = vi
            .spyOn(preparedStemImportCleanup, 'discard')
            .mockRejectedValueOnce(new Error('Retained lease cleanup failed'))
            .mockResolvedValueOnce(undefined);
        const result = await submitAdmittedPromptRequest({
            prompt: 'Import prepared stems',
            source: 'preset',
            actions: [stemAction],
            requiresConfirmation: true,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        await expect(cancelPendingChatActions({ confirmationId: result.confirmationId })).rejects.toThrow(
            'Retained lease cleanup failed'
        );
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('cancelled');
        expect(getPendingActionConfirmation(result.confirmationId)?.status).toBe('proposed');
        expect(cleanup).toHaveBeenCalledOnce();
        await expect(cancelPendingChatActions({ confirmationId: result.confirmationId })).resolves.toEqual({
            status: 'cancelled',
        });
        expect(getPendingActionConfirmation(result.confirmationId)?.status).toBe('cancelled');
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it('cleans the canonical stem lease once when waiting-phase persistence fails after handoff', async () => {
        const stems = [
            {
                audioBufferId: 'failed-phase-stem',
                assetLeaseId: 'asset-lease',
                assetHash: 'asset-hash',
                sourceBytes: 64,
                decodedBytes: 0,
            },
        ];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        const cleanup = vi.spyOn(preparedStemImportCleanup, 'discard').mockResolvedValue(undefined);
        const oldDiscard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue(undefined);
        const transition = agentRunLifecycle.transitionPhase;
        vi.spyOn(agentRunLifecycle, 'transitionPhase').mockImplementation((input) => {
            if (input.phase === 'waiting-for-approval') {
                throw new Error('Waiting phase storage failed');
            }
            return transition(input);
        });
        await expect(
            submitAdmittedPromptRequest({
                prompt: 'Import prepared stems',
                source: 'preset',
                actions: [stemAction],
                requiresConfirmation: true,
            })
        ).rejects.toThrow('Waiting phase storage failed');
        await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
        expect(oldDiscard).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('prompt-confirmation-00000000-0000-0000-0000-000000000001')?.status).toBe(
            'failed'
        );
    });

    it('retains planner cleanup responsibility when stem lease construction throws before handoff', async () => {
        const stems = [{ audioBufferId: 'prepared-stem', assetLeaseId: 'asset-lease' }];
        const stemAction = { type: 'importStemSet', payload: { stems } } as AppAction;
        const discard = vi.spyOn(preparedStemImportResources, 'discard').mockResolvedValue(undefined);
        await expect(
            submitAdmittedPromptRequest({
                prompt: 'Import prepared stems',
                source: 'preset',
                actions: [stemAction],
                requiresConfirmation: true,
            })
        ).rejects.toThrow('Prepared stem durable asset binding is incomplete');
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

        await cancelPendingChatActions({ confirmationId: result.confirmationId });
        await cancelPendingChatActions({ confirmationId: result.confirmationId });

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

        await expect(cancelPendingChatActions({ confirmationId: result.confirmationId })).rejects.toThrow(
            'Agent run state could not be persisted locally'
        );
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('cancelled');
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(durableBefore);
        await cancelPendingChatActions({ confirmationId: result.confirmationId });

        expect(setItem).toHaveBeenCalledTimes(2);
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toContain('cancelled');
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
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

        await expect(cancelPendingChatActions({ confirmationId: result.confirmationId })).rejects.toThrow(
            'Agent run state could not be persisted locally'
        );
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'preview-cleanup-retry', status: 'cleanup-pending' }),
        ]);

        await cancelPendingChatActions({ confirmationId: result.confirmationId });

        expect(cleanup).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).not.toContainEqual(
            expect.objectContaining({ assetId: 'preview-cleanup-retry', status: 'cleanup-pending' })
        );
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
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

        await cancelPendingChatActions({ confirmationId: result.confirmationId });
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'preview-sync-cleanup-retry', status: 'cleanup-pending' }),
        ]);

        await cancelPendingChatActions({ confirmationId: result.confirmationId });

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

        await cancelPendingChatActions({ confirmationId: result.confirmationId });
        rejectCleanup(new Error('temporary cleanup rejected once'));
        await vi.waitFor(() =>
            expect(agentRunLifecycle.get(RUN_ID)?.errors).toContainEqual(
                expect.objectContaining({ code: 'temporary-asset-cleanup-failed' })
            )
        );
        expect(agentRunLifecycle.get(RUN_ID)?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'preview-async-cleanup-retry', status: 'cleanup-pending' }),
        ]);

        await cancelPendingChatActions({ confirmationId: result.confirmationId });

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

    it('retains exactly one canonical confirmation and actual assistant message without execution closures', async () => {
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'prompt-bar',
            actions: [action],
            requiresConfirmation: true,
        });
        expect(result.status).toBe('awaiting-approval');
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        expect(result).not.toHaveProperty('preview');
        const confirmation = getPendingActionConfirmation(result.confirmationId);
        expect(confirmation).toMatchObject({
            runId: RUN_ID,
            status: 'proposed',
            approvalSnapshot: { commandBatch, agentApproval: approval },
        });
        expect(chatStore.value?.messages).toContainEqual(
            expect.objectContaining({
                id: confirmation?.assistantMessageId,
                pendingActionConfirmationId: result.confirmationId,
            })
        );
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(RUN_ID)).toMatchObject({
            phase: 'waiting-for-approval',
            batches: [{ batchId: 'batch-1', status: 'waiting-for-approval' }],
        });
    });

    it('rejects a prompt longer than the configured request ceiling and reports the refusal', async () => {
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, requestChars: 10 });

        await expect(submitAdmittedPromptRequest({ prompt: 'x'.repeat(11), source: 'prompt-bar' })).resolves.toEqual({
            status: 'rejected',
            runId: RUN_ID,
        });

        expect(agentRunLifecycle.get(RUN_ID)).toBeNull();
        expect(mocks.planPromptActions).not.toHaveBeenCalled();
        expect(mocks.notifyAiChange).toHaveBeenCalledExactlyOnceWith(
            'The request is longer than the configured requestChars limit for one agent run.',
            []
        );
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

    it('carries the planned match selector predicate records onto the persisted confirmation', async () => {
        const matchSelectorPredicates = [
            {
                itemId: 'selector-1',
                entity: 'track' as const,
                match: { all: [{ roleFamily: 'drums' as const }] },
                quantity: { unit: 'targets' as const, maximum: 8 },
                stableIds: ['track-kick'],
                actionPositions: [0],
            },
        ];
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: { actions: [action], rawText: 'Play', requiresConfirmation: true, matchSelectorPredicates },
            projectRevision: 'revision-1',
        });

        const result = await submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' });

        expect(result.status).toBe('awaiting-approval');
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        expect(getPendingActionConfirmation(result.confirmationId)).toMatchObject({
            approvalSnapshot: { matchSelectorPredicates },
        });
    });

    it('retains captured protection facts on the same compiled Prompt Bar card read by the chat thread', async () => {
        const prompt = 'turn Drums down 3 dB; leave Bass alone; keep the selected track pan as is';
        const context: ProjectContext = {
            tempo: 120,
            timeSignature: [4, 4],
            isPlaying: false,
            isRecording: false,
            isLooping: false,
            loopStart: 0,
            loopEnd: 16,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 16,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            masterGain: 0.8,
            tracks: ['Drums', 'Bass', 'Keys'].map((name) => ({
                id: `track-${name.toLowerCase()}`,
                name,
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
            })),
            selectedTrackId: 'track-keys',
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'mix',
            playheadPosition: 0,
        };
        const trackWrites = vi.spyOn(trackStore, 'set');
        const undoWrites = vi.spyOn(undoHistoryStore, 'set');
        const tracksBefore = structuredClone(trackStore.value);
        const undoBefore = structuredClone(undoHistoryStore.value);
        const reading = readExplicitProtections(prompt, context);
        expect(reading).toMatchObject({
            unresolved: [],
            namedTrackIds: ['track-bass'],
            protectedControls: [{ trackId: 'track-keys', actionTypes: ['setTrackPan'] }],
        });
        const list = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: {
                            semantic: { classification: 'simple', uncertainty: [] },
                            objective: prompt,
                            constraints: [],
                            scope: {
                                ...authority.scope,
                                targetIds: ['track-drums'],
                                protectedTargetIds: ['track-bass'],
                            },
                            capabilityIds: [],
                            assetIds: [],
                            alternatives: [],
                            validationStrategy: [],
                            stoppingConditions: [],
                        },
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'drum-cut',
                                    name: 'setTrackGain',
                                    arguments: { deltaDb: -3 },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Drums' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });
        if (list.status !== 'accepted' || list.compilerEvidence === undefined) {
            throw new Error('Expected the protected gain list to compile.');
        }
        const grounded = groundCompiledCommandBatch({
            toolCalls: list.compilerEvidence.commands,
            compilerEvidence: list.compilerEvidence,
            context,
            prompt,
            projectRevision: 'revision-1',
            workflowCapabilityId: undefined,
            selectedCompilations: [],
            transformCommands: [],
            transformTargetIds: [],
            creativeAuthority: undefined,
            providerProposal: null,
        });
        if (grounded.status !== 'grounded') {
            throw new Error(`Expected a grounded protected gain list: ${JSON.stringify(grounded)}`);
        }
        expect(grounded.groundingBasis).toBeUndefined();
        expect(grounded.protectionFacts).toEqual({
            protectedUnchanged: [{ id: 'track-bass', name: 'Bass' }],
            protectedControls: [{ trackId: 'track-keys', operations: ['setTrackPan'] }],
        });
        mocks.planPromptActions.mockResolvedValue({
            context,
            result: { ...grounded, rawText: prompt, requiresConfirmation: true },
            projectRevision: 'revision-1',
        });
        mocks.getProjectContext.mockReturnValue({
            ...context,
            selectedTrackId: 'track-drums',
            tracks: context.tracks.map((track) => ({ ...track, name: `Renamed ${track.name}` })),
        });

        const result = await submitAdmittedPromptRequest({ prompt, source: 'prompt-bar' });

        if (result.status !== 'awaiting-approval') {
            throw new Error(`Expected a pending protection card, received ${result.status}`);
        }
        const thread = readChatThreadContext();
        expect(thread?.pendingProposal?.confirmationId).toBe(result.confirmationId);
        expect(thread?.pendingProposal?.commands).toEqual([
            expect.objectContaining({
                name: 'setTrackGain',
                arguments: expect.objectContaining({ trackId: 'track-drums' }),
            }),
        ]);
        if (thread?.pendingProposal === null || thread?.pendingProposal === undefined) {
            throw new Error('Expected the Prompt Bar card in the chat thread.');
        }
        const card = getPendingActionConfirmation(thread.pendingProposal.confirmationId);
        expect(card?.approvalSnapshot.protectionFacts).toEqual(grounded.protectionFacts);
        expect(card?.approvalSnapshot.groundingBasis).toBeUndefined();
        expect(pendingActionConfirmationStore.value?.confirmations).toHaveLength(1);
        expect(agentRunLifecycle.get(RUN_ID)?.phase).toBe('waiting-for-approval');
        expect(mocks.executePromptActionGroup).not.toHaveBeenCalled();
        expect(mutateCrdtDoc).not.toHaveBeenCalled();
        expect(persistCrdtProject).not.toHaveBeenCalled();
        expect(trackWrites).not.toHaveBeenCalled();
        expect(undoWrites).not.toHaveBeenCalled();
        expect(trackStore.value).toEqual(tracksBefore);
        expect(undoHistoryStore.value).toEqual(undoBefore);
    });

    // Red when the prompt-bar route stops carrying the adopted recipes from the planned result to the approval.
    it('carries the planned adopted recipes onto the persisted confirmation', async () => {
        const adoptedRecipes = [{ recipeId: 'vocal-warm', title: 'Chest-register lift', targetId: 'track-lead' }];
        mocks.planPromptActions.mockResolvedValue({
            context: { tracks: [] },
            result: { actions: [action], rawText: 'Play', requiresConfirmation: true, adoptedRecipes },
            projectRevision: 'revision-1',
        });

        const result = await submitAdmittedPromptRequest({ prompt: 'Play', source: 'prompt-bar' });

        expect(result.status).toBe('awaiting-approval');
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        expect(getPendingActionConfirmation(result.confirmationId)).toMatchObject({
            approvalSnapshot: { adoptedRecipes },
        });
    });
});
