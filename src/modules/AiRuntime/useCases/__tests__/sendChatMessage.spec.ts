import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandBatchPreflightPort, commandTrackDefaultsPort } from '#/modules/Command/useCases';

import { type AgentRunProviderProposal } from '../../models/AgentRun';
import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { type planPromptActions } from '../planPromptActions';
import { sendChatMessage } from '../sendChatMessage';

type PlanPromptActionsInput = Parameters<typeof planPromptActions>[0];
type PreparedStemReadiness = 'ready' | 'missing' | 'cleanup-pending';

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
    getLlmEngine: vi.fn(),
    isCloudAvailable: vi.fn(),
    parseVersionedCommandBatchEnvelope: vi.fn(),
    planPromptActions: vi.fn(),
    proposePendingActionConfirmation: vi.fn(),
    resolveBackend: vi.fn(),
    setActiveAborter: vi.fn(),
    setChatGenerating: vi.fn(),
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
        mocks.isCloudAvailable.mockReturnValue(false);
        mocks.getLlmEngine.mockReturnValue(null);
        mocks.proposePendingActionConfirmation.mockReturnValue({ id: 'confirmation-fixture' });
        mocks.resolveBackend.mockReturnValue('webllm');
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
        agentRunLifecycle.clear();
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

    it('preserves the provider failure message when provider lease settlement cannot persist', async () => {
        const providerError = new Error('WebLLM provider failed');
        const leaseSettlementError = new Error('lease persistence failed');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            throw leaseSettlementError;
        });
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        });
        mocks.getLlmEngine.mockReturnValue({
            interruptGenerate: vi.fn(),
            chat: {
                completions: {
                    create: vi.fn().mockRejectedValue(providerError),
                },
            },
        });

        try {
            await expect(sendChatMessage('summarize this', { mode: 'explain' })).resolves.toBeUndefined();
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: 'WebLLM provider failed',
                    content: 'Sorry, I encountered an error while thinking about that.',
                })
            );
            expect(loggerError).not.toHaveBeenCalled();
        } finally {
            settle.mockRestore();
            loggerError.mockRestore();
            vi.unstubAllGlobals();
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

        await sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' });

        expect(mocks.compileAgentActionExecution).toHaveBeenCalledWith(
            expect.objectContaining({ actionCommandGraph: commandGraphFixture.actionCommandGraph })
        );
        expect(mocks.executePlannedActions).toHaveBeenCalledWith(expect.objectContaining({ commandBatch }));
        expect(getPlannedRun()).toMatchObject({
            scope: { targetIds: commandGraphFixture.fullTargetIds },
            plan: { scope: { targetIds: commandGraphFixture.fullTargetIds } },
        });
    });

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
