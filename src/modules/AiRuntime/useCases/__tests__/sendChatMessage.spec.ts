import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandBatchPreflightPort, commandTrackDefaultsPort } from '#/modules/Command/useCases';

import { type AgentRunProviderProposal } from '../../models/AgentRun';
import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContext } from '../../models/ProjectContext';
import {
    type CloudChatCompletionOutcome,
    type streamCloudChatCompletion,
} from '../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { agentRunStore } from '../../stores/agentRunStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import {
    AGENT_RUN_PROVIDER_PERSISTENCE_WARNING,
    AGENT_RUN_STALE_COMPLETION_WARNING,
} from '../agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { type planPromptActions } from '../planPromptActions';
import { sendChatMessage } from '../sendChatMessage';

type PlanPromptActionsInput = Parameters<typeof planPromptActions>[0];
type PreparedStemReadiness = 'ready' | 'missing' | 'cleanup-pending';
type CloudStreamOptions = Parameters<typeof streamCloudChatCompletion>[2];

const PROVIDER_PERSISTENCE_WARNING =
    'Agent run provider response recovery state could not be persisted after execution. The retained response remains visible, but its lifecycle is not durably settled. Review it before retrying.';

let plannedRunId: string | null = null;

const mocks = vi.hoisted(() => ({
    aiBackendPreference: { value: 'auto' },
    appendChatMessage: vi.fn(),
    captureProjectRevision: vi.fn(),
    settlePendingProjectWritesAndCaptureRevision: vi.fn(),
    chatState: { value: { chatMode: 'chat', isGenerating: false, messages: [] } },
    compileAgentActionExecution: vi.fn(),
    describeAgentRiskApproval: vi.fn(),
    describePendingActionConfirmation: vi.fn(),
    executePlannedActions: vi.fn(),
    executeVersionedCommandBatchEnvelope: vi.fn(),
    generateGroupId: vi.fn(),
    getActiveModelId: vi.fn(),
    getCloudProviderInfo: vi.fn(),
    getLlmEngine: vi.fn(),
    isCloudAvailable: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    planPromptActions: vi.fn(),
    proposePendingActionConfirmation: vi.fn(),
    resolveBackend: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
    streamCloudChatCompletion: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeVersionedCommandBatchEnvelope: mocks.executeVersionedCommandBatchEnvelope,
    generateGroupId: mocks.generateGroupId,
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    settlePendingProjectWritesAndCaptureRevision: mocks.settlePendingProjectWritesAndCaptureRevision,
}));

vi.mock('../../repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: mocks.isCloudAvailable,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../repositories/webLlm/getLlmEngine', () => ({
    getLlmEngine: mocks.getLlmEngine,
}));

vi.mock('../../repositories/webLlm/getActiveModelId', () => ({
    getActiveModelId: mocks.getActiveModelId,
}));

vi.mock('../../stores/aiBackendPreferenceStore', () => ({
    aiBackendPreferenceStore: mocks.aiBackendPreference,
}));

vi.mock('../../stores/chatStore', () => ({
    appendChatMessage: mocks.appendChatMessage,
    chatStore: mocks.chatState,
    setActiveAborter: mocks.setActiveAborter,
    setChatGenerating: mocks.setChatGenerating,
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../stores/pendingActionConfirmationStore', () => ({
    proposePendingActionConfirmation: mocks.proposePendingActionConfirmation,
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

vi.mock('../compileAgentActionExecution', () => ({
    compileAgentActionExecution: mocks.compileAgentActionExecution,
}));

vi.mock('../describeAgentRiskApproval', () => ({
    describeAgentRiskApproval: mocks.describeAgentRiskApproval,
}));

vi.mock('../describePendingActionConfirmation', () => ({
    describePendingActionConfirmation: mocks.describePendingActionConfirmation,
}));

vi.mock('../executePlannedActions', () => ({
    executePlannedActions: mocks.executePlannedActions,
}));

vi.mock('../planPromptActions', () => ({
    planPromptActions: mocks.planPromptActions,
}));

const commandGraphContext: ProjectContext = {
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
    tracks: [
        {
            id: 'track-kick',
            name: 'Kick',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 1,
            deviceCount: 0,
            clips: [
                {
                    id: 'clip-kick',
                    name: 'Kick clip',
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 4,
                    noteCount: 0,
                },
            ],
            devices: [],
            sends: [],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function createCommandGraphForwardingFixture() {
    const prompt = 'Create a Drum Bus, set its gain, then remove the Kick track.';
    const providerProposal = {
        semantic: { classification: 'simple' as const, uncertainty: [] },
        objective: 'Create a Drum Bus and remove the Kick track.',
        constraints: [],
        scope: {
            targetIds: ['track-kick'],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        },
        capabilityIds: [],
        assetIds: [],
        alternatives: [],
        validationStrategy: ['Validate the command dependency graph.'],
        stoppingConditions: ['Stop if the project revision changes.'],
    } satisfies AgentRunProviderProposal;
    const compiled = compileArbitraryCommandList({
        context: commandGraphContext,
        revision: 'revision-fixture',
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: providerProposal,
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: 'create-drum-bus',
                                name: 'createBus',
                                arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                            },
                            {
                                id: 'gain-drum-bus',
                                name: 'setTrackGain',
                                arguments: { trackId: '$drum-bus', gain: 0.8 },
                                dependsOn: ['create-drum-bus'],
                            },
                            {
                                id: 'remove-kick',
                                name: 'removeTrack',
                                arguments: {},
                                selector: {
                                    targetArgument: 'trackId',
                                    entity: 'track',
                                    where: { name: 'Kick' },
                                    quantity: { unit: 'targets', exactly: 1 },
                                },
                            },
                        ],
                    },
                },
            },
        ],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(compiled.status === 'rejected' ? compiled.reason : 'Expected compiler evidence');
    }
    const bridged = bridgeGroundedLlmToolCalls({
        calls: compiled.compilerEvidence.commands,
        compilerEvidence: compiled.compilerEvidence,
        context: commandGraphContext,
        projectRevision: 'revision-fixture',
        prompt,
    });
    if (bridged.rejections.length > 0 || bridged.actionCommandGraph === undefined) {
        throw new Error(bridged.rejections[0]?.reason ?? 'Expected a compiler-produced action command graph');
    }
    const identified = materializeBatchLocalActionIdentities(bridged.actions, bridged.batchLocalActionIdentities ?? []);
    if (identified.status !== 'accepted') {
        throw new Error(identified.reason);
    }
    const guarded = materializeActionStateGuards(identified.actions, commandGraphContext);
    if (guarded.status !== 'accepted') {
        throw new Error(guarded.reason);
    }
    const createdBus = guarded.actions.find((action) => action.type === 'createBus');
    if (createdBus?.type !== 'createBus') {
        throw new Error('Expected the compiler graph to retain its batch-local bus producer');
    }
    return {
        actions: guarded.actions,
        actionCommandGraph: bridged.actionCommandGraph,
        providerKnownTargetIds: compiled.compilerEvidence.providerKnownTargetIds,
        providerProposal,
        prompt,
        fullTargetIds: [createdBus.payload.busId, 'track-kick', 'clip-kick'],
    };
}

const commandGraphFixture = createCommandGraphForwardingFixture();

function createStemImportAction(audioBufferId: string): ExecutableRuntimeAction {
    return {
        type: 'importStemSet',
        payload: {
            selectionId: 'stem-selection-fixture',
            groupName: 'Imported Stems',
            projectTempo: 120,
            folderId: 'folder-imported-stems',
            stems: [
                {
                    stemId: 'stem-kick',
                    sourceName: 'Kick.wav',
                    role: 'kick',
                    sourceTempo: 120,
                    durationSeconds: 8,
                    sourceBytes: 64,
                    decodedBytes: 128,
                    audioBufferId,
                    assetHash: `sha256:${audioBufferId}`,
                    assetLeaseId: `asset-lease:${audioBufferId}`,
                    trackId: 'track-kick',
                    trackName: 'Kick',
                    trackGain: 0.8,
                    trackPan: 0,
                    clipId: 'clip-kick',
                },
            ],
        },
    };
}

function createAddTrackAction(): ExecutableRuntimeAction {
    return {
        type: 'addTrack',
        payload: { name: 'Reference', kind: 'audio' },
    };
}

function createProviderProposal(assetIds: string[]): AgentRunProviderProposal {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Import the prepared stems.',
        constraints: ['Use only the prepared stem selection.'],
        scope: {
            targetIds: [],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        },
        capabilityIds: [],
        assetIds,
        alternatives: [],
        validationStrategy: ['Validate prepared-stem readiness before confirmation.'],
        stoppingConditions: ['Stop if the prepared stem is unavailable.'],
    };
}

function configureCommandPlanning(action: ExecutableRuntimeAction): void {
    const scope = {
        targetIds: [],
        targetRanges: [],
        protectedTargetIds: [],
        protectedRanges: [],
    };
    const grants = {
        allowedOperationPrefixes: [action.type],
        create: true,
        delete: false,
        routing: false,
        tempo: false,
        master: false,
        file: action.type === 'importStemSet',
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    };
    mocks.compileAgentActionExecution.mockReturnValue({
        commandEnvelopes: [],
        commandBatch: { serialized: '{}', authority: { scope, grants } },
        agentApproval: { policy: { risk: 'confirm', reasons: [] } },
        requiresConfirmation: true,
    });
    mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
        status: 'valid',
        envelope: {
            batchId: 'batch-fixture',
            commands: [],
            idempotencyKey: 'batch-fixture-idempotency',
            preconditions: [],
            scope,
        },
    });
}

function configurePromptPlanning(
    action: ExecutableRuntimeAction,
    readiness: PreparedStemReadiness,
    providerProposal?: AgentRunProviderProposal
): void {
    configureCommandPlanning(action);
    mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
        const runId = input.streamIdentity?.runId;
        if (runId === undefined) {
            throw new Error('Expected sendChatMessage to admit the planning run first.');
        }
        plannedRunId = runId;
        if (action.type === 'importStemSet' && readiness !== 'missing') {
            for (const stem of action.payload.stems) {
                agentRunLifecycle.registerTemporaryAsset({
                    runId,
                    assetId: stem.audioBufferId,
                    kind: 'import',
                    cleanupOwner: 'stem-import-preparation',
                });
                if (readiness === 'cleanup-pending') {
                    agentRunLifecycle.prepareTemporaryAssetCleanup({
                        runId,
                        assetId: stem.audioBufferId,
                        cleanupOwner: 'stem-import-preparation',
                    });
                }
            }
        }
        return {
            context: {},
            result: {
                actions: [action],
                rawText: 'fixture plan',
                requiresConfirmation: true,
                ...(providerProposal === undefined ? {} : { providerProposal }),
            },
            projectRevision: 'revision-fixture',
        };
    });
}

function configureCommandGraphForwarding(branch: 'immediate' | 'confirmation' | 'plan') {
    const requiresConfirmation = branch === 'confirmation';
    const scope = {
        targetIds: [...commandGraphFixture.fullTargetIds],
        targetRanges: [],
        protectedTargetIds: [],
        protectedRanges: [],
    };
    const grants = {
        allowedOperationPrefixes: ['createBus', 'setTrackGain', 'removeTrack'],
        create: true,
        delete: true,
        routing: false,
        tempo: false,
        master: false,
        file: false,
        audioUpload: false,
        remoteGeneration: false,
        autoCommit: false,
    };
    const commandBatch = { serialized: '{}', authority: { scope, grants } };
    mocks.describePendingActionConfirmation.mockReturnValue({
        actionLabels: ['Create Drum Bus', 'Set Drum Bus gain', 'Remove Kick'],
        affectedIds: [...commandGraphFixture.fullTargetIds],
        protectedUnchanged: [],
        content: 'Fixture graph confirmation',
    });
    mocks.compileAgentActionExecution.mockReturnValue({
        commandEnvelopes: ['command-create-bus', 'command-gain-bus', 'command-remove-kick'],
        commandBatch,
        agentApproval: { policy: { risk: requiresConfirmation ? 'confirm' : 'low', reasons: [] } },
        requiresConfirmation,
    });
    mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
        status: 'valid',
        envelope: {
            batchId: 'batch-graph',
            commands: [
                { commandId: 'command-create-bus' },
                { commandId: 'command-gain-bus' },
                { commandId: 'command-remove-kick' },
            ],
            idempotencyKey: 'batch-graph-idempotency',
            preconditions: [],
            scope,
        },
    });
    mocks.executePlannedActions.mockResolvedValue({ status: 'no-op', actions: [] });
    mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
        const runId = input.streamIdentity?.runId;
        if (runId === undefined) {
            throw new Error('Expected sendChatMessage to admit the planning run first.');
        }
        plannedRunId = runId;
        return {
            context: commandGraphContext,
            result: {
                actions: commandGraphFixture.actions,
                actionCommandGraph: commandGraphFixture.actionCommandGraph,
                rawText: 'compiler-produced graph fixture',
                requiresConfirmation,
                executionMode: 'atomic' as const,
                providerKnownTargetIds: commandGraphFixture.providerKnownTargetIds,
                providerProposal: commandGraphFixture.providerProposal,
            },
            projectRevision: 'revision-fixture',
        };
    });
    return commandBatch;
}

function getPlannedRun() {
    if (plannedRunId === null) {
        throw new Error('Expected the planning fixture to capture a run id.');
    }
    const run = agentRunLifecycle.get(plannedRunId);
    if (run === null) {
        throw new Error('Expected the admitted run to remain inspectable.');
    }
    return run;
}

function getMostRecentlyAdmittedRunId(): string {
    const runId = agentRunStore.value?.runs.at(-1)?.runId;
    if (runId === undefined) {
        throw new Error('Expected the run admission to complete before arming storage failure.');
    }
    return runId;
}

function createSuccessfulWebLlmEngine(content: string) {
    async function* streamCompletion() {
        yield {
            choices: [{ delta: { content }, finish_reason: 'stop' }],
        };
    }

    return {
        interruptGenerate: vi.fn(),
        chat: {
            completions: {
                create: vi.fn(async () => streamCompletion()),
            },
        },
    };
}

function createFailingWebLlmEngine(content: string, error: Error) {
    async function* streamCompletion() {
        yield {
            choices: [{ delta: { content } }],
        };
        throw error;
    }

    return {
        interruptGenerate: vi.fn(),
        chat: {
            completions: {
                create: vi.fn(async () => streamCompletion()),
            },
        },
    };
}

describe('sendChatMessage retained-provider selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerHandlerMap(getArrangementHandlers());
        commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
        agentRunLifecycle.clear();
        plannedRunId = null;
        mocks.aiBackendPreference.value = 'auto';
        mocks.chatState.value = { chatMode: 'chat', isGenerating: false, messages: [] };
        mocks.captureProjectRevision.mockReturnValue('revision-fixture');
        mocks.settlePendingProjectWritesAndCaptureRevision.mockReturnValue('revision-fixture');
        mocks.describeAgentRiskApproval.mockReturnValue('Risk approval required.');
        mocks.describePendingActionConfirmation.mockReturnValue({
            actionLabels: ['Fixture action'],
            affectedIds: [],
            protectedUnchanged: [],
            content: 'Fixture confirmation',
        });
        mocks.generateGroupId.mockReturnValue({ groupId: 'group-fixture', groupLabel: 'Fixture group' });
        mocks.getActiveModelId.mockReturnValue('fixture-model');
        mocks.getCloudProviderInfo.mockReturnValue(null);
        mocks.isCloudAvailable.mockReturnValue(false);
        mocks.getLlmEngine.mockReturnValue(null);
        mocks.proposePendingActionConfirmation.mockReturnValue({ id: 'confirmation-fixture' });
        mocks.resolveBackend.mockReturnValue('webllm');
        llmStatusStore.set({ state: 'idle' });
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
        agentRunLifecycle.clear();
        llmStatusStore.set({ state: 'idle' });
    });

    it('fails closed when the explicitly selected hosted provider is not configured', async () => {
        mocks.aiBackendPreference.value = 'cloud';
        mocks.resolveBackend.mockReturnValue('cloud');

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            'Hosted AI is not configured.'
        );
    });

    it('fails closed when browser WebLLM is selected without an initialized engine', async () => {
        mocks.aiBackendPreference.value = 'webllm';
        mocks.resolveBackend.mockReturnValue('webllm');

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            'AI Engine is not initialized or not supported on this device.'
        );
    });

    it('preserves provider content while marking an unsettled successful response for restart recovery', async () => {
        const content = 'The mix is ready for a final balance pass.';
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(() => {
            throw storageFailure;
        });
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine(content));
        expect(AGENT_RUN_PROVIDER_PERSISTENCE_WARNING).toBe(PROVIDER_PERSISTENCE_WARNING);

        try {
            await expect(sendChatMessage('How does the mix sound?', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    content: `${content}\n\n_${PROVIDER_PERSISTENCE_WARNING}_`,
                    error: PROVIDER_PERSISTENCE_WARNING,
                })
            );
            expect(run).toMatchObject({
                phase: 'planning',
                errors: [],
                workLeases: [expect.objectContaining({ workId: 'provider-response', terminalState: null })],
            });
            await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
                recoveredRunIds: [run?.runId],
            });
            expect(agentRunLifecycle.get(run?.runId ?? '')).toMatchObject({
                phase: 'paused',
                manualResume: { required: true, workIds: ['provider-response'] },
                workLeases: [expect.objectContaining({ workId: 'provider-response', terminalState: 'orphaned' })],
            });
            expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'fixture-model' });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledOnce();
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('records hosted provider usage against the exact terminal provider receipt and budget attempt', async () => {
        const content = 'The hosted mix summary is ready.';
        const providerUsage = await import('../recordAgentProviderUsage');
        const recordProviderUsage = vi.spyOn(providerUsage, 'recordAgentProviderUsage');
        mocks.aiBackendPreference.value = 'cloud';
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.isCloudAvailable.mockReturnValue(true);
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
        });
        mocks.streamCloudChatCompletion.mockImplementation(
            async (
                _messages: Parameters<typeof streamCloudChatCompletion>[0],
                onToken: Parameters<typeof streamCloudChatCompletion>[1],
                options?: CloudStreamOptions
            ): Promise<CloudChatCompletionOutcome> => {
                onToken(content);
                options?.onUsage?.({
                    type: 'usage',
                    mode: 'final',
                    usage: {
                        inputTokens: 321,
                        outputTokens: 34,
                        cachedInputTokens: 21,
                        reasoningTokens: 8,
                    },
                    provenance: 'provider-reported',
                });
                return { status: 'complete' };
            }
        );

        try {
            await expect(sendChatMessage('Summarize the hosted mix.', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            if (run === null) {
                throw new Error('Expected the hosted provider run to remain inspectable.');
            }
            const providerReceiptIdentity = `provider:cloud:${run.runId}`;
            expect(recordProviderUsage).toHaveBeenCalledWith(
                run.runId,
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    correlationId: providerReceiptIdentity,
                    status: 'complete',
                    usage: {
                        inputTokens: 321,
                        outputTokens: 34,
                        cachedInputTokens: 21,
                        reasoningTokens: 8,
                        provenance: 'provider-reported',
                    },
                }),
                providerReceiptIdentity,
                { terminal: true }
            );
            expect(run.providerUsage).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        provider: 'openai',
                        model: 'gpt-4o-mini',
                        correlationId: providerReceiptIdentity,
                        status: 'complete',
                        routeId: 'cloud:openai:gpt-4o-mini',
                        executor: 'cloud',
                    }),
                ])
            );
            expect(run.budgetAttempts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        attemptId: providerReceiptIdentity,
                        category: 'remoteTokens',
                    }),
                ])
            );
        } finally {
            recordProviderUsage.mockRestore();
        }
    });

    it('keeps a hosted provider stream failure terminal with its exact provider lease and usage identity', async () => {
        const providerError = new Error('Hosted provider stream failed');
        const partialContent = 'The hosted bridge summary started.';
        const providerUsage = await import('../recordAgentProviderUsage');
        const recordProviderUsage = vi.spyOn(providerUsage, 'recordAgentProviderUsage');
        mocks.aiBackendPreference.value = 'cloud';
        mocks.resolveBackend.mockReturnValue('cloud');
        mocks.isCloudAvailable.mockReturnValue(true);
        mocks.getCloudProviderInfo.mockReturnValue({
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
        });
        mocks.streamCloudChatCompletion.mockImplementation(
            async (
                _messages: Parameters<typeof streamCloudChatCompletion>[0],
                onToken: Parameters<typeof streamCloudChatCompletion>[1]
            ): Promise<CloudChatCompletionOutcome> => {
                onToken(partialContent);
                throw providerError;
            }
        );

        try {
            await expect(sendChatMessage('Summarize the hosted bridge.', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            if (run === null) {
                throw new Error('Expected the hosted failed-provider run to remain inspectable.');
            }
            const providerReceiptIdentity = `provider:cloud:${run.runId}`;
            expect(run).toMatchObject({
                phase: 'failed',
                errors: [expect.objectContaining({ category: 'provider' })],
                workLeases: [
                    expect.objectContaining({
                        runId: run.runId,
                        workId: 'provider-response',
                        leaseId: `${run.runId}:provider-response:0`,
                        cancellationGeneration: 0,
                        idempotencyKey: providerReceiptIdentity,
                        receiptIdentity: providerReceiptIdentity,
                        terminalState: 'failed',
                    }),
                ],
                providerUsage: [
                    expect.objectContaining({
                        provider: 'openai',
                        model: 'gpt-4o-mini',
                        correlationId: providerReceiptIdentity,
                        status: 'partial',
                        routeId: 'cloud:openai:gpt-4o-mini',
                        executor: 'cloud',
                    }),
                ],
            });
            expect(recordProviderUsage).toHaveBeenCalledWith(
                run.runId,
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    correlationId: providerReceiptIdentity,
                    status: 'partial',
                    partialOutputDisposition: 'preserve',
                }),
                providerReceiptIdentity,
                { terminal: true }
            );
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: providerError.message,
                    content: `${partialContent}\n\n_Response incomplete because the provider stream failed._`,
                })
            );
            expect(llmStatusStore.value).toEqual({ state: 'error', message: providerError.message });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            recordProviderUsage.mockRestore();
        }
    });

    it('retains regular-chat content without reopening a cancelled run after stale provider settlement', async () => {
        const content = 'The chorus is ready to automate.';
        const providerUsage = await import('../recordAgentProviderUsage');
        const recordProviderUsageCall = vi.spyOn(providerUsage, 'recordAgentProviderUsage');
        const recordProviderUsage = vi.spyOn(agentRunLifecycle, 'recordProviderUsage');
        const transitionPhase = vi.spyOn(agentRunLifecycle, 'transitionPhase');
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'cancelled' });
            return { status: 'stale' };
        });
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine(content));

        try {
            await expect(sendChatMessage('Summarize the chorus.', { mode: 'explain' })).resolves.toBeUndefined();

            const runId = getMostRecentlyAdmittedRunId();
            const run = agentRunLifecycle.get(runId);
            if (run === null) {
                throw new Error('Expected the stale provider run to remain inspectable.');
            }
            const providerReceiptIdentity = `provider:webllm:${run.runId}`;
            expect(run.phase).toBe('cancelled');
            expect(transitionPhase).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'completed' }));
            expect(recordProviderUsage).toHaveBeenCalledOnce();
            expect(recordProviderUsageCall).toHaveBeenCalledWith(
                run.runId,
                {
                    schemaVersion: 2,
                    provider: 'webllm',
                    model: 'fixture-model',
                    correlationId: providerReceiptIdentity,
                    status: 'complete',
                    finishReason: 'stop',
                    failure: null,
                    partialOutputDisposition: 'none',
                    output: { text: content, reasoning: '', toolCalls: [], structuredOutput: null },
                    usage: {
                        inputTokens: null,
                        outputTokens: null,
                        cachedInputTokens: null,
                        reasoningTokens: null,
                        provenance: 'unavailable',
                    },
                    ignoredProviderEvents: [],
                },
                providerReceiptIdentity,
                { terminal: true }
            );
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    content: `${content}\n\n_${AGENT_RUN_STALE_COMPLETION_WARNING}_`,
                    error: AGENT_RUN_STALE_COMPLETION_WARNING,
                })
            );
            expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'fixture-model' });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            settleWorkLease.mockRestore();
            transitionPhase.mockRestore();
            recordProviderUsage.mockRestore();
            recordProviderUsageCall.mockRestore();
        }
    });

    it('keeps a streamed provider failure cancelled after stale settlement', async () => {
        const providerError = new Error('WebLLM provider failed during streaming');
        const partialContent = 'The bridge starts with a muted guitar.';
        const providerUsage = await import('../recordAgentProviderUsage');
        const recordProviderUsageCall = vi.spyOn(providerUsage, 'recordAgentProviderUsage');
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'cancelled' });
            return { status: 'stale' };
        });
        mocks.getLlmEngine.mockReturnValue(createFailingWebLlmEngine(partialContent, providerError));

        try {
            await expect(sendChatMessage('Summarize the arrangement.', { mode: 'explain' })).resolves.toBeUndefined();

            const runId = getMostRecentlyAdmittedRunId();
            const run = agentRunLifecycle.get(runId);
            if (run === null) {
                throw new Error('Expected the stale failed-provider run to remain inspectable.');
            }
            const providerReceiptIdentity = `provider:webllm:${run.runId}`;
            expect(run).toMatchObject({
                phase: 'cancelled',
                errors: [],
                providerUsage: [
                    {
                        provider: 'webllm',
                        model: 'fixture-model',
                        inputTokens: null,
                        outputTokens: null,
                        cachedInputTokens: null,
                        provenance: 'unavailable',
                        correlationId: providerReceiptIdentity,
                        status: 'partial',
                        retryable: true,
                        partialOutputDisposition: 'preserve',
                        routeId: 'webllm:webllm:fixture-model',
                        executor: 'webllm',
                        fallbackReason: null,
                    },
                ],
            });
            expect(recordProviderUsageCall).toHaveBeenCalledWith(
                run.runId,
                {
                    schemaVersion: 2,
                    provider: 'webllm',
                    model: 'fixture-model',
                    correlationId: providerReceiptIdentity,
                    status: 'partial',
                    finishReason: 'error',
                    failure: {
                        code: 'provider-stream-failed',
                        retryable: true,
                        safeMessage: 'The model provider request failed.',
                        correlationId: providerReceiptIdentity,
                        partialOutputDisposition: 'preserve',
                    },
                    partialOutputDisposition: 'preserve',
                    output: { text: partialContent, reasoning: '', toolCalls: [], structuredOutput: null },
                    usage: {
                        inputTokens: null,
                        outputTokens: null,
                        cachedInputTokens: null,
                        reasoningTokens: null,
                        provenance: 'unavailable',
                    },
                    ignoredProviderEvents: [],
                },
                providerReceiptIdentity,
                { terminal: true }
            );
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: providerError.message,
                    content: `${partialContent}\n\n_Response incomplete because the provider stream failed._`,
                })
            );
            expect(llmStatusStore.value).toEqual({ state: 'error', message: providerError.message });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            settleWorkLease.mockRestore();
            recordProviderUsageCall.mockRestore();
        }
    });

    it('keeps a streamed provider failure authoritative when failed-lease settlement persistence throws', async () => {
        const providerError = new Error('WebLLM provider failed during streaming');
        const partialContent = 'The bridge starts with a muted guitar.';
        const settlementFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            throw settlementFailure;
        });
        mocks.getLlmEngine.mockReturnValue(createFailingWebLlmEngine(partialContent, providerError));

        try {
            await expect(sendChatMessage('Summarize the arrangement.', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            expect(run).toMatchObject({
                phase: 'failed',
                errors: [expect.objectContaining({ category: 'provider' })],
            });
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: `${providerError.message}\n\n${PROVIDER_PERSISTENCE_WARNING}`,
                    content: `${partialContent}\n\n_Response incomplete because the provider stream failed._\n\n_${PROVIDER_PERSISTENCE_WARNING}_`,
                })
            );
            expect(llmStatusStore.value).toEqual({ state: 'error', message: providerError.message });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: settlementFailure,
                    message: 'Failed provider work lease settlement failed',
                })
            );
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves a completed regular-chat response when provider usage persistence fails', async () => {
        const content = 'The arrangement now has a clear final chorus.';
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const recordProviderUsage = vi.spyOn(agentRunLifecycle, 'recordProviderUsage').mockImplementation(() => {
            throw storageFailure;
        });
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine(content));

        try {
            await expect(sendChatMessage('Summarize the arrangement.', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({ isStreaming: false, content, error: undefined })
            );
            expect(run?.errors).toEqual([]);
            expect(run?.phase).toBe('completed');
            expect(JSON.parse(localStorage.getItem('sourdaw-agent-runs') ?? '')).toMatchObject({
                json: {
                    runs: [expect.objectContaining({ runId: run?.runId, phase: 'completed' })],
                },
            });
            expect(run?.workLeases).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ workId: 'provider-response', terminalState: 'completed' }),
                ])
            );
            expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'fixture-model' });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledOnce();
        } finally {
            recordProviderUsage.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves a completed regular-chat response when completion lifecycle persistence fails', async () => {
        const content = 'The arrangement is ready for a final automation pass.';
        const lifecycleFailure = new Error('Completed lifecycle persistence failed');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const transitionPhase = agentRunLifecycle.transitionPhase;
        const transition = vi.spyOn(agentRunLifecycle, 'transitionPhase').mockImplementation((input) => {
            if (input.phase === 'completed') {
                throw lifecycleFailure;
            }
            return transitionPhase(input);
        });
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine(content));

        try {
            await expect(sendChatMessage('Summarize the arrangement.', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            if (run === null) {
                throw new Error('Expected the completed provider lease to remain inspectable after lifecycle failure.');
            }
            const providerReceiptIdentity = `provider:webllm:${run.runId}`;
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({ isStreaming: false, content, error: undefined })
            );
            expect(run).toMatchObject({
                phase: 'planning',
                errors: [],
                workLeases: [
                    expect.objectContaining({
                        runId: run.runId,
                        workId: 'provider-response',
                        leaseId: `${run.runId}:provider-response:0`,
                        cancellationGeneration: 0,
                        idempotencyKey: providerReceiptIdentity,
                        receiptIdentity: providerReceiptIdentity,
                        terminalState: 'completed',
                    }),
                ],
            });
            await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
                recoveredRunIds: [run.runId],
            });
            expect(agentRunLifecycle.get(run.runId)).toMatchObject({
                phase: 'partially-completed',
                manualResume: { required: false, workIds: [] },
                workLeases: [expect.objectContaining({ workId: 'provider-response', terminalState: 'completed' })],
            });
            expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: 'fixture-model' });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: lifecycleFailure,
                    message: 'Completed provider lifecycle persistence failed',
                })
            );
        } finally {
            transition.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves a planning rejection when provider work settlement persistence fails', async () => {
        const rejectionReason = 'The requested command cannot be resolved.';
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(() => {
            throw storageFailure;
        });
        mocks.planPromptActions.mockResolvedValue({
            context: {},
            result: {
                actions: [],
                rawText: 'fixture rejection',
                requiresConfirmation: false,
                rejectionReason,
            },
            projectRevision: 'revision-fixture',
        });

        try {
            await expect(sendChatMessage('resolve this command', { mode: 'apply' })).resolves.toBeUndefined();

            expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    role: 'assistant',
                    content: `Command plan was not retained. ${PROVIDER_PERSISTENCE_WARNING}`,
                    error: PROVIDER_PERSISTENCE_WARNING,
                })
            );
            expect(settleWorkLease).toHaveBeenCalledWith(
                expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' })
            );
            expect(loggerError).toHaveBeenCalledOnce();
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('does not materialize a confirmation when provider planning settlement persistence fails', async () => {
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementationOnce(() => {
            throw storageFailure;
        });
        configureCommandGraphForwarding('confirmation');

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

            const run = getPlannedRun();
            expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
            expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
            expect(mocks.executePlannedActions).not.toHaveBeenCalled();
            expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    role: 'assistant',
                    content: expect.stringContaining(PROVIDER_PERSISTENCE_WARNING),
                    error: PROVIDER_PERSISTENCE_WARNING,
                })
            );
            expect(run).toMatchObject({
                phase: 'planning',
                errors: [],
                plan: null,
                workLeases: [
                    expect.objectContaining({
                        workId: 'provider-planning',
                        terminalState: null,
                    }),
                ],
            });
            await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
                recoveredRunIds: [run.runId],
            });
            expect(agentRunLifecycle.get(run.runId)).toMatchObject({
                phase: 'paused',
                manualResume: { required: true, workIds: ['provider-planning'] },
                workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: 'orphaned' })],
            });
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: storageFailure,
                    message: 'Completed provider planning work lease settlement failed',
                })
            );
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('keeps a streamed provider failure terminal when usage persistence fails', async () => {
        const providerError = new Error('WebLLM provider failed during streaming');
        const partialContent = 'The bridge starts with a muted guitar.';
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const recordProviderUsage = vi.spyOn(agentRunLifecycle, 'recordProviderUsage').mockImplementation(() => {
            throw storageFailure;
        });
        mocks.getLlmEngine.mockReturnValue(createFailingWebLlmEngine(partialContent, providerError));

        try {
            await expect(sendChatMessage('Summarize the arrangement.', { mode: 'explain' })).resolves.toBeUndefined();

            const run = agentRunLifecycle.get(getMostRecentlyAdmittedRunId());
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: providerError.message,
                    content: `${partialContent}\n\n_Response incomplete because the provider stream failed._`,
                })
            );
            expect(run).toEqual(
                expect.objectContaining({
                    phase: 'failed',
                    workLeases: expect.arrayContaining([
                        expect.objectContaining({ workId: 'provider-response', terminalState: 'failed' }),
                    ]),
                })
            );
            expect(llmStatusStore.value).toEqual({ state: 'error', message: providerError.message });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledOnce();
        } finally {
            recordProviderUsage.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves the provider failure message when agent-run storage fails after admission', async () => {
        const providerError = new Error('WebLLM provider failed');
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
        let admittedRunId: string | null = null;
        let armedSetItemCount: number | null = null;
        mocks.getLlmEngine.mockReturnValue({});
        mocks.getActiveModelId
            .mockImplementationOnce(() => 'fixture-model')
            .mockImplementationOnce(() => {
                admittedRunId = getMostRecentlyAdmittedRunId();
                armedSetItemCount = storageSetItem.mock.calls.length;
                storageSetItem.mockImplementation(() => {
                    throw storageFailure;
                });
                throw providerError;
            });

        try {
            await expect(sendChatMessage('summarize this', { mode: 'explain' })).resolves.toBeUndefined();
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: `WebLLM provider failed\n\n${PROVIDER_PERSISTENCE_WARNING}`,
                    content: `Sorry, I encountered an error while thinking about that.\n\n_${PROVIDER_PERSISTENCE_WARNING}_`,
                })
            );
            expect(armedSetItemCount).not.toBeNull();
            expect(storageSetItem.mock.calls.length).toBeGreaterThan(armedSetItemCount ?? 0);
            expect(agentRunLifecycle.get(admittedRunId ?? '')).toEqual(
                expect.objectContaining({
                    phase: 'failed',
                    errors: expect.arrayContaining([
                        expect.objectContaining({
                            code: 'agent.provider',
                            category: 'provider',
                            cause: { kind: 'unknown-internal', source: 'provider-planning' },
                        }),
                    ]),
                })
            );
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: expect.objectContaining({ message: 'Agent run state could not be persisted locally' }),
                    message: 'Failed provider work lease settlement failed',
                })
            );
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            storageSetItem.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves the planning failure message when agent-run storage fails after admission', async () => {
        const planningError = new Error('Planning provider failed');
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
        let admittedRunId: string | null = null;
        let armedSetItemCount: number | null = null;
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId ?? null;
            armedSetItemCount = storageSetItem.mock.calls.length;
            storageSetItem.mockImplementation(() => {
                throw storageFailure;
            });
            throw planningError;
        });

        try {
            await expect(sendChatMessage('add a track', { mode: 'apply' })).resolves.toBeUndefined();
            expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    role: 'assistant',
                    content: `Failed to process prompt command.\n\n_${PROVIDER_PERSISTENCE_WARNING}_`,
                    error: `Planning provider failed\n\n${PROVIDER_PERSISTENCE_WARNING}`,
                })
            );
            expect(armedSetItemCount).not.toBeNull();
            expect(storageSetItem.mock.calls.length).toBeGreaterThan(armedSetItemCount ?? 0);
            expect(agentRunLifecycle.get(admittedRunId ?? '')).toEqual(
                expect.objectContaining({
                    phase: 'failed',
                    errors: expect.arrayContaining([
                        expect.objectContaining({
                            code: 'agent.internal',
                            category: 'internal',
                            cause: { kind: 'unknown-internal', source: 'provider-planning' },
                        }),
                    ]),
                    workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: 'failed' })],
                })
            );
            expect(loggerError).toHaveBeenCalledOnce();
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            storageSetItem.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('keeps a stale planning failure cancelled without recording a new terminal error', async () => {
        const planningError = new Error('Planning provider failed');
        let admittedRunId: string | null = null;
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId ?? null;
            throw planningError;
        });
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(sendChatMessage('add a track', { mode: 'apply' })).resolves.toBeUndefined();

            expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
            expect(mocks.executePlannedActions).not.toHaveBeenCalled();
            expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    role: 'assistant',
                    content: `Failed to process prompt command.\n\n_${AGENT_RUN_STALE_COMPLETION_WARNING}_`,
                    error: `Planning provider failed\n\n${AGENT_RUN_STALE_COMPLETION_WARNING}`,
                })
            );
            expect(agentRunLifecycle.get(admittedRunId ?? '')).toMatchObject({
                phase: 'cancelled',
                errors: [],
                workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: null })],
            });
            expect(settleWorkLease).toHaveBeenCalledWith(
                expect.objectContaining({ workId: 'provider-planning', terminalState: 'failed' })
            );
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            settleWorkLease.mockRestore();
        }
    });

    it('settles the provider-planning lease when planning rejects', async () => {
        const planningError = new Error('Planning provider failed');
        let admittedRunId: string | null = null;
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId ?? null;
            throw planningError;
        });

        await expect(sendChatMessage('add a track', { mode: 'apply' })).resolves.toBeUndefined();

        const runId = admittedRunId ?? '';
        expect(runId).not.toBe('');
        expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                role: 'assistant',
                content: 'Failed to process prompt command.',
                error: planningError.message,
            })
        );
        expect(agentRunLifecycle.get(runId)).toEqual(
            expect.objectContaining({
                phase: 'failed',
                workLeases: expect.arrayContaining([
                    expect.objectContaining({
                        runId,
                        workId: 'provider-planning',
                        leaseId: `${runId}:provider-planning:0`,
                        cancellationGeneration: 0,
                        idempotencyKey: `provider:webllm:${runId}`,
                        receiptIdentity: `provider:webllm:${runId}`,
                        terminalState: 'failed',
                    }),
                ]),
            })
        );
    });

    it('preserves a verified preview when preview lease settlement persistence fails', async () => {
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const previewResource = { release: vi.fn() };
        const settleLease = agentRunWorkLease.settle;
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            if (input.workId.startsWith('preview:')) {
                throw storageFailure;
            }
            return settleLease(input);
        });
        configureCommandGraphForwarding('plan');
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'previewed',
            resource: previewResource,
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            expect(previewResource.release).toHaveBeenCalledOnce();
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    content:
                        'Previewed without changing the project:\n\n- Create Drum Bus\n- Set Drum Bus gain\n- Remove Kick',
                })
            );
            expect(getPlannedRun()).toMatchObject({ phase: 'completed' });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledOnce();
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('settles a successful preview with its exact completed work lease', async () => {
        const previewResource = { release: vi.fn() };
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle');
        configureCommandGraphForwarding('plan');
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'previewed',
            resource: previewResource,
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            const run = getPlannedRun();
            const previewReceiptIdentity = `preview:${run.runId}:batch-graph`;
            expect(settleWorkLease).toHaveBeenCalledWith({
                runId: run.runId,
                workId: 'preview:batch-graph',
                leaseId: `${run.runId}:preview:batch-graph:0`,
                cancellationGeneration: 0,
                idempotencyKey: previewReceiptIdentity,
                receiptIdentity: previewReceiptIdentity,
                terminalState: 'completed',
            });
            expect(run).toMatchObject({
                phase: 'completed',
                workLeases: expect.arrayContaining([
                    expect.objectContaining({
                        runId: run.runId,
                        workId: 'preview:batch-graph',
                        leaseId: `${run.runId}:preview:batch-graph:0`,
                        cancellationGeneration: 0,
                        idempotencyKey: previewReceiptIdentity,
                        receiptIdentity: previewReceiptIdentity,
                        terminalState: 'completed',
                    }),
                ]),
            });
            expect(previewResource.release).toHaveBeenCalledOnce();
        } finally {
            settleWorkLease.mockRestore();
        }
    });

    it('preserves a verified preview when preview batch persistence fails', async () => {
        const batchFailure = new Error('Preview batch persistence failed');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const previewResource = { release: vi.fn() };
        const updateBatchStatus = vi.spyOn(agentRunLifecycle, 'updateBatchStatus').mockImplementation(() => {
            throw batchFailure;
        });
        configureCommandGraphForwarding('plan');
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'previewed',
            resource: previewResource,
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            expect(previewResource.release).toHaveBeenCalledOnce();
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    content:
                        'Previewed without changing the project:\n\n- Create Drum Bus\n- Set Drum Bus gain\n- Remove Kick',
                })
            );
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({ cause: batchFailure, message: 'Preview batch persistence failed' })
            );
        } finally {
            updateBatchStatus.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves a verified preview when completion lifecycle persistence fails', async () => {
        const lifecycleFailure = new Error('Preview completion lifecycle persistence failed');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const previewResource = { release: vi.fn() };
        const transitionPhase = agentRunLifecycle.transitionPhase;
        const transition = vi.spyOn(agentRunLifecycle, 'transitionPhase').mockImplementation((input) => {
            if (input.phase === 'completed') {
                throw lifecycleFailure;
            }
            return transitionPhase(input);
        });
        configureCommandGraphForwarding('plan');
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'previewed',
            resource: previewResource,
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            expect(previewResource.release).toHaveBeenCalledOnce();
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    content:
                        'Previewed without changing the project:\n\n- Create Drum Bus\n- Set Drum Bus gain\n- Remove Kick',
                })
            );
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({ cause: lifecycleFailure, message: 'Preview lifecycle persistence failed' })
            );
        } finally {
            transition.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves the resumed-run callback error when provider settlement persistence fails', async () => {
        const callbackError = new Error('Resume admission callback failed');
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            throw storageFailure;
        });
        let admittedRunId: string | null = null;

        try {
            await expect(
                sendChatMessage('resume this plan', {
                    mode: 'apply',
                    onResumedRunAdmitted: (runId) => {
                        admittedRunId = runId;
                        throw callbackError;
                    },
                })
            ).rejects.toThrow(callbackError);

            expect(agentRunLifecycle.get(admittedRunId ?? '')).toMatchObject({ phase: 'failed' });
            expect(loggerError).toHaveBeenCalledOnce();
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('preserves a planning rejection when agent-run storage fails after provider settlement', async () => {
        const rejectionReason = 'The requested command cannot be resolved.';
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const writeStorageItem = Storage.prototype.setItem;
        const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
        let admittedRunId: string | null = null;
        let armedSetItemCount: number | null = null;
        mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
            admittedRunId = input.streamIdentity?.runId ?? null;
            armedSetItemCount = storageSetItem.mock.calls.length;
            storageSetItem
                .mockImplementationOnce((key, value) => {
                    return writeStorageItem.call(localStorage, key, value);
                })
                .mockImplementation(() => {
                    throw storageFailure;
                });
            return {
                context: {},
                result: {
                    actions: [],
                    rawText: 'fixture rejection',
                    requiresConfirmation: false,
                    rejectionReason,
                },
                projectRevision: 'revision-fixture',
            };
        });

        try {
            await expect(sendChatMessage('resolve this command', { mode: 'apply' })).resolves.toBeUndefined();
            expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    role: 'assistant',
                    content: `Command not executed: ${rejectionReason}`,
                    error: rejectionReason,
                })
            );
            expect(armedSetItemCount).not.toBeNull();
            expect(storageSetItem.mock.calls.length).toBeGreaterThan(armedSetItemCount ?? 0);
            expect(agentRunLifecycle.get(admittedRunId ?? '')).toEqual(
                expect.objectContaining({
                    phase: 'failed',
                    workLeases: expect.arrayContaining([
                        expect.objectContaining({
                            workId: 'provider-planning',
                            terminalState: 'completed',
                            leaseId: expect.any(String),
                            receiptIdentity: expect.any(String),
                            settledAt: expect.any(Number),
                        }),
                    ]),
                    errors: expect.arrayContaining([
                        expect.objectContaining({
                            code: 'agent.resolution',
                            category: 'resolution',
                            cause: { kind: 'known-domain', source: 'provider-planning' },
                        }),
                    ]),
                })
            );
            expect(loggerError).not.toHaveBeenCalled();
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            storageSetItem.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('forwards same-run live prepared-stem readiness into application planning', async () => {
        configurePromptPlanning(createStemImportAction('buffer-ready'), 'ready');

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun().plan?.capabilities).toContainEqual(
            expect.objectContaining({ id: 'selected-stem-assets', source: 'asset', status: 'available' })
        );
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
    });

    it('admits provider asset ids that name the same-run prepared stems', async () => {
        configurePromptPlanning(createStemImportAction('buffer-ready'), 'ready', createProviderProposal(['stem-kick']));

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun().plan?.capabilities).toContainEqual(
            expect.objectContaining({ id: 'stem-kick', source: 'asset', status: 'available' })
        );
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
    });

    it('fails closed when a provider asset id does not name a selected prepared stem', async () => {
        configurePromptPlanning(
            createStemImportAction('buffer-ready'),
            'ready',
            createProviderProposal(['stem-provider-invented'])
        );

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it('fails closed when the prepared-stem resources are absent', async () => {
        configurePromptPlanning(createStemImportAction('buffer-missing'), 'missing');

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it('fails closed when prepared-stem resources are pending cleanup', async () => {
        configurePromptPlanning(createStemImportAction('buffer-releasing'), 'cleanup-pending');

        await sendChatMessage('Import the prepared stems', { mode: 'apply' });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it('keeps unrelated planning independent of prepared-stem readiness', async () => {
        configurePromptPlanning(createAddTrackAction(), 'missing');

        await sendChatMessage('Add a reference track', { mode: 'apply' });

        expect(getPlannedRun().plan?.capabilities).toContainEqual(
            expect.objectContaining({ id: 'addTrack', source: 'action-catalog', status: 'available' })
        );
        expect(getPlannedRun().plan?.capabilities).not.toContainEqual(expect.objectContaining({ source: 'asset' }));
        expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
    });

    it('forwards a compiler-produced graph and provider-known scope through immediate application', async () => {
        const commandBatch = configureCommandGraphForwarding('immediate');
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle');

        try {
            await sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' });

            expect(mocks.compileAgentActionExecution).toHaveBeenCalledWith(
                expect.objectContaining({ actionCommandGraph: commandGraphFixture.actionCommandGraph })
            );
            expect(mocks.executePlannedActions).toHaveBeenCalledWith(expect.objectContaining({ commandBatch }));
            const run = getPlannedRun();
            expect(settleWorkLease).toHaveBeenCalledWith({
                runId: run.runId,
                workId: 'provider-planning',
                leaseId: `${run.runId}:provider-planning:0`,
                cancellationGeneration: 0,
                idempotencyKey: `provider:webllm:${run.runId}`,
                receiptIdentity: `provider:webllm:${run.runId}`,
                terminalState: 'completed',
            });
            expect(run).toMatchObject({
                scope: { targetIds: commandGraphFixture.fullTargetIds },
                plan: { scope: { targetIds: commandGraphFixture.fullTargetIds } },
                workLeases: expect.arrayContaining([
                    expect.objectContaining({
                        runId: run.runId,
                        workId: 'provider-planning',
                        terminalState: 'completed',
                    }),
                ]),
            });
        } finally {
            settleWorkLease.mockRestore();
        }
    });

    const staleImmediateCommandResults = [
        { status: 'committed', outcome: 'committed', content: 'The project change committed.' },
        { status: 'executed', outcome: 'executed', content: 'The runtime command executed.' },
    ] satisfies readonly {
        status: 'committed' | 'executed';
        outcome: 'committed' | 'executed';
        content: string;
    }[];

    it.each(staleImmediateCommandResults)(
        'keeps a stale immediate $status receipt terminal after cancellation',
        async ({ status, outcome, content }) => {
            configureCommandGraphForwarding('immediate');
            const claimWorkLease = vi.spyOn(agentRunWorkLease, 'claim');
            const transitionPhase = vi.spyOn(agentRunLifecycle, 'transitionPhase');
            const settleLease = agentRunWorkLease.settle;
            const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
                if (input.workId === 'batch-graph') {
                    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'cancelled' });
                    return { status: 'stale' };
                }
                return settleLease(input);
            });
            mocks.executePlannedActions.mockImplementation(async () => {
                const runId = getMostRecentlyAdmittedRunId();
                return {
                    status,
                    actions: [],
                    receipt: {
                        schemaVersion: 2,
                        runId,
                        batchId: 'batch-graph',
                        outcome,
                        pendingEffects: [],
                        links: { render: [], analysis: [] },
                    },
                };
            });

            try {
                await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeDefined();

                const run = getPlannedRun();
                const receiptIdentity = `2:${run.runId}:batch-graph:${outcome}`;
                expect(run).toMatchObject({
                    phase: 'partially-completed',
                    receipts: [expect.objectContaining({ workId: 'batch-graph', receiptIdentity })],
                });
                expect(settleWorkLease).toHaveBeenCalledWith({
                    runId: run.runId,
                    workId: 'batch-graph',
                    leaseId: `${run.runId}:batch-graph:0`,
                    cancellationGeneration: 0,
                    idempotencyKey: 'batch-graph-idempotency',
                    receiptIdentity: `command:${run.runId}:batch-graph`,
                    terminalState: 'completed',
                });
                expect(transitionPhase).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'completed' }));
                expect(claimWorkLease.mock.calls.filter(([input]) => input.workId === 'batch-graph')).toHaveLength(1);
                expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        isStreaming: false,
                        error: expect.stringContaining('cancelled or replaced'),
                        content: expect.stringContaining(content),
                    })
                );
                expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                    expect.any(String),
                    expect.objectContaining({ content: expect.stringContaining('Do not retry automatically') })
                );
            } finally {
                settleWorkLease.mockRestore();
                transitionPhase.mockRestore();
                claimWorkLease.mockRestore();
            }
        }
    );

    const immediateFailureResults = [
        {
            status: 'invalidated' as const,
            reason: 'The project revision changed before the command committed.',
            phase: 'cancelled' as const,
            terminalState: 'failed' as const,
            persistedTerminalState: 'cancelled' as const,
            errors: [],
            content: 'The project changed before this command could commit. Review it and submit the command again.',
        },
        {
            status: 'ambiguous' as const,
            reason: 'The command may have partially committed before interruption',
            phase: 'failed' as const,
            terminalState: 'failed' as const,
            persistedTerminalState: 'failed' as const,
            errors: [expect.objectContaining({ category: 'conflict', retriable: false })],
            content:
                'The command stopped after an uncertain partial commit: The command may have partially committed before interruption. Do not retry it; inspect the project first.',
        },
    ] as const;

    it.each(immediateFailureResults)(
        'keeps an immediate $status command terminal with its exact terminal command lease',
        async ({ status, reason, phase, terminalState, persistedTerminalState, errors, content }) => {
            configureCommandGraphForwarding('immediate');
            mocks.executePlannedActions.mockResolvedValue({ status, reason, actions: [] });
            const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle');
            const cancelRun = vi.spyOn(agentRunCancellation, 'cancel');

            try {
                await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

                const run = getPlannedRun();
                const commandReceiptIdentity = `command:${run.runId}:batch-graph`;
                expect(settleWorkLease).toHaveBeenCalledWith({
                    runId: run.runId,
                    workId: 'batch-graph',
                    leaseId: `${run.runId}:batch-graph:0`,
                    cancellationGeneration: 0,
                    idempotencyKey: 'batch-graph-idempotency',
                    receiptIdentity: commandReceiptIdentity,
                    terminalState,
                });
                expect(mocks.executePlannedActions).toHaveBeenCalledOnce();
                expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
                if (status === 'invalidated') {
                    expect(cancelRun).toHaveBeenCalledWith({ runId: run.runId, reason });
                    const commandSettlementIndex = settleWorkLease.mock.calls.findIndex(
                        ([input]) => input.workId === 'batch-graph'
                    );
                    expect(commandSettlementIndex).toBeGreaterThanOrEqual(0);
                    const cancellationOrder = cancelRun.mock.invocationCallOrder[0];
                    const commandSettlementOrder = settleWorkLease.mock.invocationCallOrder[commandSettlementIndex];
                    if (cancellationOrder === undefined || commandSettlementOrder === undefined) {
                        throw new Error('Expected invalidation cancellation to precede command lease settlement.');
                    }
                    expect(cancellationOrder).toBeLessThan(commandSettlementOrder);
                } else {
                    expect(cancelRun).not.toHaveBeenCalled();
                }
                expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                    expect.any(String),
                    expect.objectContaining({ isStreaming: false, error: reason, content })
                );
                expect(run).toMatchObject({ phase, retriableWork: [] });
                expect(run.errors).toEqual(errors.length === 0 ? [] : expect.arrayContaining([...errors]));
                expect(run.workLeases).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            runId: run.runId,
                            workId: 'batch-graph',
                            terminalState: persistedTerminalState,
                        }),
                    ])
                );
            } finally {
                cancelRun.mockRestore();
                settleWorkLease.mockRestore();
            }
        }
    );

    it('preserves a fast command failure when agent-run storage fails after the command lease is claimed', async () => {
        const commandFailure = 'Command executor failed';
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const storageSetItem = vi.spyOn(Storage.prototype, 'setItem');
        let admittedRunId: string | null = null;
        let armedSetItemCount: number | null = null;
        configureCommandGraphForwarding('immediate');
        mocks.executePlannedActions.mockImplementation(async () => {
            admittedRunId = getMostRecentlyAdmittedRunId();
            armedSetItemCount = storageSetItem.mock.calls.length;
            storageSetItem.mockImplementation(() => {
                throw storageFailure;
            });
            return { status: 'failed', reason: commandFailure, actions: [] };
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: commandFailure,
                    content: `Failed to execute prompt command atomically: ${commandFailure}`,
                })
            );
            expect(armedSetItemCount).not.toBeNull();
            expect(storageSetItem.mock.calls.length).toBeGreaterThan(armedSetItemCount ?? 0);
            expect(agentRunLifecycle.get(admittedRunId ?? '')).toEqual(
                expect.objectContaining({
                    phase: 'failed',
                    errors: expect.arrayContaining([
                        expect.objectContaining({
                            code: 'agent.project',
                            category: 'project',
                            cause: { kind: 'known-domain', source: 'command-execution' },
                        }),
                    ]),
                })
            );
            expect(loggerError).not.toHaveBeenCalled();
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
        } finally {
            storageSetItem.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('settles the failed immediate command lease with its batch identity', async () => {
        const commandFailure = 'Command executor failed';
        configureCommandGraphForwarding('immediate');
        mocks.executePlannedActions.mockResolvedValue({ status: 'failed', reason: commandFailure, actions: [] });

        await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

        const run = getPlannedRun();
        expect(run).toEqual(
            expect.objectContaining({
                phase: 'failed',
                workLeases: expect.arrayContaining([
                    expect.objectContaining({
                        runId: run.runId,
                        workId: 'batch-graph',
                        leaseId: `${run.runId}:batch-graph:0`,
                        cancellationGeneration: 0,
                        idempotencyKey: 'batch-graph-idempotency',
                        receiptIdentity: `command:${run.runId}:batch-graph`,
                        terminalState: 'failed',
                    }),
                ]),
            })
        );
        expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.objectContaining({ isStreaming: false, error: commandFailure })
        );
    });

    const directTerminalCommandResults = [
        {
            status: 'no-op',
            terminalState: 'completed',
            phase: 'completed',
            content: 'No project changes were needed.',
        },
        {
            status: 'cancelled',
            terminalState: 'cancelled',
            phase: 'cancelled',
            content: 'Command cancelled before it committed. No project changes were applied.',
        },
    ] as const;

    it.each(directTerminalCommandResults)(
        'settles a direct $status command with its exact $terminalState lease',
        async ({ status, terminalState, phase, content }) => {
            configureCommandGraphForwarding('immediate');
            const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle');
            if (status === 'cancelled') {
                mocks.executePlannedActions.mockResolvedValue({
                    status: 'cancelled',
                    reason: 'Command cancellation requested.',
                    actions: [],
                });
            } else {
                mocks.executePlannedActions.mockResolvedValue({ status: 'no-op', actions: [] });
            }

            try {
                await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

                const run = getPlannedRun();
                const commandReceiptIdentity = `command:${run.runId}:batch-graph`;
                expect(settleWorkLease).toHaveBeenCalledWith({
                    runId: run.runId,
                    workId: 'batch-graph',
                    leaseId: `${run.runId}:batch-graph:0`,
                    cancellationGeneration: 0,
                    idempotencyKey: 'batch-graph-idempotency',
                    receiptIdentity: commandReceiptIdentity,
                    terminalState,
                });
                expect(run).toMatchObject({
                    phase,
                    workLeases: expect.arrayContaining([
                        expect.objectContaining({
                            runId: run.runId,
                            workId: 'batch-graph',
                            leaseId: `${run.runId}:batch-graph:0`,
                            cancellationGeneration: 0,
                            idempotencyKey: 'batch-graph-idempotency',
                            receiptIdentity: commandReceiptIdentity,
                            terminalState,
                        }),
                    ]),
                });
                expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                    expect.any(String),
                    expect.objectContaining({ isStreaming: false, content })
                );
            } finally {
                settleWorkLease.mockRestore();
            }
        }
    );

    it('forwards a compiler-produced graph and provider-known scope into pending confirmation', async () => {
        configureCommandGraphForwarding('confirmation');
        const { compileAgentActionExecution } = await vi.importActual<typeof import('../compileAgentActionExecution')>(
            '../compileAgentActionExecution'
        );
        const { parseVersionedCommandBatchEnvelope } =
            await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
        mocks.compileAgentActionExecution.mockImplementation(compileAgentActionExecution);
        mocks.parseVersionedCommandBatchEnvelope.mockImplementation(parseVersionedCommandBatchEnvelope);
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'revision-fixture',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-kick': 'track-kick:fixture' },
        }));

        await sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' });

        expect(mocks.compileAgentActionExecution).toHaveBeenCalledWith(
            expect.objectContaining({ actionCommandGraph: commandGraphFixture.actionCommandGraph })
        );
        const confirmation = mocks.proposePendingActionConfirmation.mock.calls[0]?.[0];
        expect(confirmation).toEqual(expect.objectContaining({ actions: commandGraphFixture.actions }));
        const parsed = parseVersionedCommandBatchEnvelope(
            confirmation?.commandBatch.serialized ?? '',
            confirmation?.commandBatch.authority
        );
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const [producer, dependent] = parsed.envelope.commands;
        expect(dependent?.dependencyIds).toEqual([producer?.commandId]);
        expect(parsed.envelope.batchLocalBindings).toEqual([
            {
                bindingId: '$drum-bus',
                producerArgument: 'busId',
                producerCommandId: producer?.commandId,
            },
        ]);
        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(getPlannedRun()).toMatchObject({
            phase: 'waiting-for-approval',
            scope: { targetIds: commandGraphFixture.fullTargetIds },
        });
    });

    it('forwards a compiler-produced graph and provider-known scope through plan-only execution', async () => {
        configureCommandGraphForwarding('plan');

        await sendChatMessage(commandGraphFixture.prompt, { mode: 'plan' });

        expect(mocks.compileAgentActionExecution).toHaveBeenCalledWith(
            expect.objectContaining({
                actionCommandGraph: commandGraphFixture.actionCommandGraph,
                mode: 'apply',
            })
        );
        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(getPlannedRun()).toMatchObject({
            phase: 'completed',
            scope: { targetIds: commandGraphFixture.fullTargetIds },
            plan: { scope: { targetIds: commandGraphFixture.fullTargetIds } },
        });
    });
});
