import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    type parseVersionedCommandBatchEnvelope,
    commandBatchPreflightPort,
    commandTrackDefaultsPort,
} from '#/modules/Command/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS, describeAgentRunCreationRefusal } from '../../models/AgentResourceLimits';
import { type AgentRunProviderProposal } from '../../models/AgentRun';
import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContext } from '../../models/ProjectContext';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { agentRunStore, readAgentRunState } from '../../stores/agentRunStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { getAgentPlanProposalIdentity } from '../../transformers/normalizeAgentPlanProposal';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { preparedStemImportCleanup } from '../agentReference/discardPreparedStemImportResources';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { agentRunControls } from '../getAgentRunControlProjection';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { getPlanningProviderSchemaContract } from '../planningProviderSchema';
import { type planPromptActions } from '../planPromptActions';
import { sendChatMessage } from '../sendChatMessage';

type PlanPromptActionsInput = Parameters<typeof planPromptActions>[0];
type PreparedStemReadiness = 'ready' | 'missing' | 'cleanup-pending';
type ParsedCommandBatch = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>;
type BatchEnvelope = ParsedCommandBatch['envelope'];
type BatchCommandEnvelope = BatchEnvelope['commands'][number];

const FIXTURE_BUDGETS: BatchEnvelope['budgets'] = {
    maxCommands: 16,
    maxCreatedTracks: 4,
    maxDeletedObjects: 4,
    maxAffectedTracks: 8,
    maxAffectedClips: 8,
    maxAutomationPoints: 64,
    maxImportedAssets: 8,
    maxRenderJobs: 2,
};

function fixtureCommandEnvelope(
    commandId: string,
    operation: BatchCommandEnvelope['operation'],
    overrides: Partial<BatchCommandEnvelope> = {}
): BatchCommandEnvelope {
    return {
        schemaVersion: 1,
        commandId,
        issuedAt: 0,
        operation,
        arguments: {},
        argumentsDigest: `digest-${commandId}`,
        dependencyIds: [],
        reason: `Fixture ${operation}`,
        expectedEffect: `Fixture ${operation} effect`,
        objectReferences: [],
        time: [],
        parameterUnits: [],
        seed: null,
        normalizedProjectRevision: 'revision-fixture',
        availableDeviceVersions: {},
        applicationAssignedIds: [],
        ...overrides,
    };
}

/**
 * The real parser hands back a whole batch envelope, and the confirmation path now reads the
 * dependency and effect fields as well as the scope, so the mocked parse returns the whole shape.
 */
function validParsedBatch(input: {
    batchId: string;
    commands?: readonly BatchCommandEnvelope[];
    grants: BatchEnvelope['grants'];
    idempotencyKey: string;
    preconditions?: BatchEnvelope['preconditions'];
    scope: BatchEnvelope['scope'];
}): ParsedCommandBatch {
    return {
        status: 'valid',
        envelope: {
            schemaVersion: 1,
            runId: 'run-fixture',
            batchId: input.batchId,
            projectId: 'project-fixture',
            baseRevision: 'revision-fixture',
            idempotencyKey: input.idempotencyKey,
            intent: 'Fixture batch',
            mode: 'commit',
            scope: input.scope,
            preconditions: input.preconditions ?? [],
            commands: input.commands ?? [],
            postconditions: [],
            dependencies: [],
            batchLocalBindings: [],
            grants: input.grants,
            budgets: FIXTURE_BUDGETS,
        },
    };
}

const WORK_PERSISTENCE_WARNING =
    'Agent run work recovery state could not be persisted after execution. The retained work outcome remains visible, but its lifecycle is not durably settled. Review it before retrying.';
const COMMAND_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
const FAILURE_PERSISTENCE_WARNING =
    'Agent run failure recovery state could not be persisted. The work failed, and no successful artifact is claimed. Review the durable run state before retrying.';
const COMPLETION_PERSISTENCE_WARNING =
    'Agent run completion recovery state could not be persisted. No completed artifact is claimed. Review the durable run state before retrying.';
const STALE_FAILURE_WARNING =
    'Agent work failed after its run lease was cancelled or replaced. No successful artifact is claimed, and the terminal run was not reopened.';
const STALE_CANCELLATION_WARNING =
    'Agent work was cancelled after its run lease was cancelled or replaced. No successful artifact is claimed, and the terminal run was not reopened.';

let plannedRunId: string | null = null;

const mocks = vi.hoisted(() => ({
    stopMeasuredPreviewAudition: vi.fn(async () => ({ status: 'idle' })),
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
    initWebLlmEngine: vi.fn(),
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

vi.mock('../stopMeasuredPreviewAudition', () => ({ stopMeasuredPreviewAudition: mocks.stopMeasuredPreviewAudition }));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    executeVersionedCommandBatchEnvelope: mocks.executeVersionedCommandBatchEnvelope,
    generateGroupId: mocks.generateGroupId,
    parseVersionedCommandBatchEnvelope: mocks.parseVersionedCommandBatchEnvelope,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: mocks.captureProjectRevision,
    settlePendingProjectWritesAndCaptureRevision: mocks.settlePendingProjectWritesAndCaptureRevision,
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    captureActiveBranchReference: vi.fn(),
    compactProject: vi.fn(),
    createCrdtDoc: vi.fn(),
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    loadCrdtProject: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    beginBranchSession: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    projectCrdtToStores: vi.fn(),
    removeCrdtDoc: vi.fn(),
    projectBranchSession: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
    endBranchSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: vi.fn(),
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
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

vi.mock('../../repositories/webLlm/initWebLlmEngine', () => ({
    initWebLlmEngine: mocks.initWebLlmEngine,
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

// The chat and confirmation stores are mocked without their state, so the thread reads as empty.
vi.mock('../readChatThreadContext', () => ({ readChatThreadContext: () => null }));

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
    if (createdBus?.type !== 'createBus' || createdBus.payload.busId === undefined) {
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

function createStemImportAction(audioBufferId: string): Extract<ExecutableRuntimeAction, { type: 'importStemSet' }> {
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

function configureCommandPlanning(action: ExecutableRuntimeAction) {
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
    mocks.parseVersionedCommandBatchEnvelope.mockReturnValue(
        validParsedBatch({
            batchId: 'batch-fixture',
            grants,
            idempotencyKey: 'batch-fixture-idempotency',
            scope,
        })
    );
    return { grants, scope };
}

function configurePromptPlanning(
    action: ExecutableRuntimeAction,
    readiness: PreparedStemReadiness,
    providerProposal?: AgentRunProviderProposal
) {
    const authority = configureCommandPlanning(action);
    mocks.planPromptActions.mockImplementation(async (input: PlanPromptActionsInput) => {
        const runId = input.streamIdentity?.runId;
        if (runId === undefined) {
            throw new Error('Expected sendChatMessage to admit the planning run first.');
        }
        plannedRunId = runId;
        if (action.type === 'importStemSet' && readiness !== 'missing') {
            // Register through the owning module the way `planPromptActions`
            // does: a bare `registerTemporaryAsset` records the asset without
            // the cleanup callback that actually discards the prepared stem.
            preparedStemImportResources.register({ runId, stems: action.payload.stems });
            if (readiness === 'cleanup-pending') {
                for (const stem of action.payload.stems) {
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
    return authority;
}

function configureCommandGraphForwarding(
    branch: 'immediate' | 'confirmation' | 'plan',
    projectRevision = 'revision-fixture'
) {
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
    mocks.parseVersionedCommandBatchEnvelope.mockReturnValue(
        validParsedBatch({
            batchId: 'batch-graph',
            commands: [
                fixtureCommandEnvelope('command-create-bus', 'createBus'),
                fixtureCommandEnvelope('command-gain-bus', 'setTrackGain', {
                    dependencyIds: ['command-create-bus'],
                }),
                fixtureCommandEnvelope('command-remove-kick', 'removeTrack'),
            ],
            grants,
            idempotencyKey: 'batch-graph-idempotency',
            scope,
        })
    );
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
            projectRevision,
        };
    });
    return { commandBatch, projectRevision };
}

function createPendingResumeDecision(input: {
    runId: string;
    proposalIdentity: string;
    authority: ReturnType<typeof configureCommandPlanning>;
    mode?: 'apply' | 'plan';
}): void {
    const budgets = { limits: {}, consumed: {} };
    agentRunLifecycle.create({
        runId: input.runId,
        request: 'Add a reference track',
        mode: input.mode ?? 'apply',
        createdRevision: 'revision-fixture',
        scope: input.authority.scope,
        grants: input.authority.grants,
        budgets,
    });
    agentRunLifecycle.recordDecision({
        runId: input.runId,
        decision: {
            decisionId: 'decision-reference-track',
            capabilitySchemaIdentity: getPlanningProviderSchemaContract().identity,
            proposalIdentity: input.proposalIdentity,
            budgets,
            revision: 'revision-fixture',
            scope: input.authority.scope,
            grants: input.authority.grants,
            alternatives: [{ id: 'add-reference', label: 'Add the reference track', changesAuthority: false }],
            reason: 'Choose whether to add the reference track.',
            selectedAlternativeId: null,
            resumeAttemptId: null,
        },
    });
    agentRunLifecycle.requireManualResume({
        runId: input.runId,
        reason: 'Choose whether to add the reference track.',
        workIds: [],
    });
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
        // The shared persistence caller reads the materialized approval snapshot.
        // Carry only the input's optional metric state; this supplies no proof or permit.
        mocks.proposePendingActionConfirmation.mockImplementation((input) => ({
            id: 'confirmation-fixture',
            approvalSnapshot: { metricGoalState: input.metricGoalState },
        }));
        mocks.resolveBackend.mockReturnValue('webllm');
        llmStatusStore.set({ state: 'idle' });
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
        agentRunLifecycle.clear();
        agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
        llmStatusStore.set({ state: 'idle' });
    });

    it('refuses an explain request longer than the configured request ceiling without admitting a run', async () => {
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine('The mix is balanced.'));
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, requestChars: 4 });

        await expect(sendChatMessage('summarize this', { mode: 'explain' })).rejects.toThrow(
            describeAgentRunCreationRefusal('requestChars')
        );

        expect(readAgentRunState().runs).toEqual([]);
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

    it('keeps explain model-backed and admits no run when no backend is available', async () => {
        mocks.resolveBackend.mockReturnValue('none');

        await expect(sendChatMessage('explain this mix', { mode: 'explain' })).rejects.toThrow(
            'No AI backend available. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
        );

        expect(mocks.stopMeasuredPreviewAudition).not.toHaveBeenCalled();
        expect(readAgentRunState().runs).toEqual([]);
        expect(mocks.planPromptActions).not.toHaveBeenCalled();
    });

    it('admits prompt planning without a backend and records no model route or provider usage', async () => {
        mocks.resolveBackend.mockReturnValue('none');
        mocks.planPromptActions.mockImplementation(async () => {
            expect(mocks.stopMeasuredPreviewAudition).toHaveBeenCalledTimes(1);
            return {
                context: {},
                result: {
                    actions: [],
                    planningOutcome: {
                        kind: 'denied',
                        reason: 'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.',
                    },
                },
                projectRevision: 'revision-fixture',
            };
        });

        await expect(sendChatMessage('make the chorus warmer', { mode: 'apply' })).resolves.toBeUndefined();

        expect(mocks.planPromptActions).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'make the chorus warmer',
                providerPlanning: 'disabled',
                onProviderResult: undefined,
            })
        );
        expect(readAgentRunState().runs).toEqual([
            expect.objectContaining({
                modelRoute: expect.objectContaining({ selectedRouteId: null }),
                providerUsage: [],
                phase: 'completed',
                workLeases: [
                    expect.objectContaining({
                        workId: 'local-planning',
                        ownerKind: 'analysis',
                        terminalState: 'completed',
                    }),
                ],
            }),
        ]);
        expect(mocks.appendChatMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                role: 'assistant',
                content:
                    'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.',
            })
        );
    });

    it('routes Explain through one shared planning lease and ordinary answer without a placeholder', async () => {
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine('unused'));
        mocks.planPromptActions.mockResolvedValue({
            context: {},
            projectRevision: 'revision-fixture',
            result: {
                actions: [],
                rawText: 'Explain',
                requiresConfirmation: false,
                planningOutcome: { kind: 'answer', text: 'Shared answer', evidence: [] },
            },
        });
        await sendChatMessage('Explain', { mode: 'explain' });
        expect(mocks.resolveBackend).toHaveBeenCalledWith({ operation: 'tools', modality: 'text', streaming: false });
        expect(mocks.planPromptActions).toHaveBeenCalledWith(expect.objectContaining({ profile: 'readonly-answer' }));
        expect(readAgentRunState().runs).toEqual([
            expect.objectContaining({
                mode: 'explain',
                phase: 'completed',
                workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' })],
            }),
        ]);
        expect(
            mocks.appendChatMessage.mock.calls.map(([message]) => ({ role: message.role, content: message.content }))
        ).toEqual([
            { role: 'user', content: 'Explain' },
            { role: 'assistant', content: 'Shared answer' },
        ]);
        expect(mocks.streamCloudChatCompletion).not.toHaveBeenCalled();
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
    });

    it.each([
        { actions: [createAddTrackAction()] },
        { preparationRequest: 'stem-import' },
        { requiresConfirmation: true },
        { batchSchedule: {} },
        { providerProposal: {} },
    ])('refuses forged internal Explain answer metadata before materialization: %j', async (violation) => {
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine('unused'));
        mocks.planPromptActions.mockResolvedValue({
            context: {},
            projectRevision: 'revision-fixture',
            result: {
                actions: [],
                rawText: 'Explain',
                requiresConfirmation: false,
                planningOutcome: { kind: 'answer', text: 'Forged answer', evidence: [] },
                ...violation,
            },
        });
        await sendChatMessage('Explain', {
            mode: 'explain',
            grants: {
                allowedOperationPrefixes: ['addTrack'],
                create: true,
                delete: true,
                routing: true,
                tempo: true,
                master: true,
                file: true,
                audioUpload: true,
                remoteGeneration: true,
                autoCommit: true,
            },
        });
        expect(mocks.compileAgentActionExecution).not.toHaveBeenCalled();
        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.appendChatMessage.mock.calls.some(([message]) => message.content === 'Forged answer')).toBe(false);
        expect(readAgentRunState().runs).toEqual([expect.objectContaining({ phase: 'failed' })]);
    });

    it('settles a shared Explain provider failure without publishing partial prose', async () => {
        mocks.getLlmEngine.mockReturnValue(createSuccessfulWebLlmEngine('unused'));
        mocks.planPromptActions.mockRejectedValue(new Error('Explain provider transport failed'));
        await sendChatMessage('Explain', { mode: 'explain' });
        expect(readAgentRunState().runs).toEqual([
            expect.objectContaining({
                phase: 'failed',
                workLeases: [expect.objectContaining({ workId: 'provider-planning', terminalState: 'failed' })],
            }),
        ]);
        expect(mocks.appendChatMessage.mock.calls.at(-1)?.[0].error).toContain('Explain provider transport failed');
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
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
                    content: `Command plan was not retained. ${COMPLETION_PERSISTENCE_WARNING}`,
                    error: COMPLETION_PERSISTENCE_WARNING,
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
                    content: expect.stringContaining(COMPLETION_PERSISTENCE_WARNING),
                    error: COMPLETION_PERSISTENCE_WARNING,
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
                    content: `Failed to process prompt command.\n\n_${FAILURE_PERSISTENCE_WARNING}_`,
                    error: `Planning provider failed\n\n${FAILURE_PERSISTENCE_WARNING}`,
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
                    content: `Failed to process prompt command.\n\n_${STALE_FAILURE_WARNING}_`,
                    error: `Planning provider failed\n\n${STALE_FAILURE_WARNING}`,
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
                    error: WORK_PERSISTENCE_WARNING,
                    content: `Previewed without changing the project:\n\n- Create Drum Bus\n- Set Drum Bus gain\n- Remove Kick\n\n_${WORK_PERSISTENCE_WARNING}_`,
                })
            );
            expect(getPlannedRun()).toMatchObject({ phase: 'previewing' });
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
            expect(mocks.setChatGenerating).toHaveBeenLastCalledWith(false);
            expect(loggerError).toHaveBeenCalledOnce();
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('retains a failed preview settlement warning in the outer assistant failure', async () => {
        const executionError = new Error('Preview executor failed');
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleLease = agentRunWorkLease.settle;
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            if (input.workId.startsWith('preview:')) {
                throw storageFailure;
            }
            return settleLease(input);
        });
        configureCommandGraphForwarding('plan');
        mocks.executeVersionedCommandBatchEnvelope.mockRejectedValue(executionError);

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            const commandAssistantMessage = mocks.appendChatMessage.mock.calls
                .map(([message]) => message)
                .find((message) => message.role === 'assistant' && message.isCommandAction === true);
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(commandAssistantMessage?.id, {
                isStreaming: false,
                content: `Failed to execute prompt command.\n\n_${FAILURE_PERSISTENCE_WARNING}_`,
                error: `${executionError.message}\n\n${FAILURE_PERSISTENCE_WARNING}`,
            });
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Failed preview work lease settlement failed',
                    cause: storageFailure,
                })
            );
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    it('settles a successful preview with its exact completed work lease', async () => {
        const previewResource = { release: vi.fn() };
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle');
        const bindAbortController = vi.spyOn(agentRunCancellation, 'bindAbortController');
        const transitionPhase = vi.spyOn(agentRunLifecycle, 'transitionPhase');
        const { commandBatch, projectRevision } = configureCommandGraphForwarding('plan', 'revision-planned-preview');
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'previewed',
            resource: previewResource,
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            const run = getPlannedRun();
            const commandAssistantMessage = mocks.appendChatMessage.mock.calls
                .map(([message]) => message)
                .find((message) => message.role === 'assistant' && message.isCommandAction === true);
            const activeAbortController = mocks.setActiveAborter.mock.calls
                .map(([controller]) => controller)
                .find((controller) => controller instanceof AbortController);
            const previewCancellationBinding = bindAbortController.mock.calls
                .map(([input]) => input)
                .find((input) => input.lease.workId === 'preview:batch-graph');
            const previewReceiptIdentity = `preview:${run.runId}:batch-graph`;
            expect(mocks.executeVersionedCommandBatchEnvelope).toHaveBeenCalledWith(commandBatch);
            expect(transitionPhase).toHaveBeenCalledWith({
                runId: run.runId,
                phase: 'previewing',
                revision: projectRevision,
            });
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
            expect(commandAssistantMessage).toEqual(expect.objectContaining({ id: expect.any(String) }));
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                commandAssistantMessage?.id,
                expect.objectContaining({
                    isStreaming: false,
                    content:
                        'Previewed without changing the project:\n\n- Create Drum Bus\n- Set Drum Bus gain\n- Remove Kick',
                })
            );
            expect(activeAbortController).toBeInstanceOf(AbortController);
            expect(previewCancellationBinding?.controller).toBe(activeAbortController);
        } finally {
            transitionPhase.mockRestore();
            bindAbortController.mockRestore();
            settleWorkLease.mockRestore();
        }
    });

    it('cancels a rejected preview when the project advanced beyond its planned revision', async () => {
        const rejectionReason = 'Preview targets changed after planning.';
        const cancelRun = vi.spyOn(agentRunCancellation, 'cancel');
        configureCommandGraphForwarding('plan', 'revision-planned-stale');
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'rejected',
            reason: rejectionReason,
        });

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'preview' })).resolves.toBeUndefined();

            const run = getPlannedRun();
            expect(mocks.captureProjectRevision).toHaveReturnedWith('revision-fixture');
            expect(cancelRun).toHaveBeenCalledWith({ runId: run.runId, reason: rejectionReason });
        } finally {
            cancelRun.mockRestore();
        }
    });

    it('leases and releases planned prepared-stem resources during preview', async () => {
        const action = createStemImportAction('buffer-preview-stem');
        const discardPreparedStems = vi.spyOn(preparedStemImportCleanup, 'discard').mockResolvedValue(undefined);
        configurePromptPlanning(action, 'ready', createProviderProposal(['stem-kick']));
        mocks.executeVersionedCommandBatchEnvelope.mockResolvedValue({
            status: 'previewed',
            resource: { release: vi.fn() },
        });

        try {
            await expect(sendChatMessage('Import the prepared stems', { mode: 'preview' })).resolves.toBeUndefined();

            expect(discardPreparedStems).toHaveBeenCalledWith(action.payload.stems);
            expect(getPlannedRun().temporaryAssets).toEqual([]);
        } finally {
            discardPreparedStems.mockRestore();
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

    it.each([
        ['missing', 'apply'],
        ['missing', 'plan'],
        ['cleanup-pending', 'apply'],
        ['cleanup-pending', 'plan'],
    ] as const)('fails closed when prepared-stem resources are %s in %s mode', async (readiness, mode) => {
        configurePromptPlanning(createStemImportAction(`buffer-${readiness}-${mode}`), readiness);

        await sendChatMessage('Import the prepared stems', { mode });

        expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null });
        expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
        expect(mocks.executeVersionedCommandBatchEnvelope).not.toHaveBeenCalled();
        expect(mocks.executePlannedActions).not.toHaveBeenCalled();
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

    it('hands a prepared confirmation to its consumer before the next microtask', async () => {
        configureCommandGraphForwarding('confirmation');
        const ordering: string[] = [];
        const recordBatch = agentRunLifecycle.recordBatch;
        const recordBatchSpy = vi.spyOn(agentRunLifecycle, 'recordBatch').mockImplementation((input) => {
            const result = recordBatch(input);
            queueMicrotask(() => ordering.push('microtask-after-batch'));
            return result;
        });
        mocks.proposePendingActionConfirmation.mockImplementation((input) => {
            ordering.push('confirmation-proposed');
            expect(getPlannedRun().batches).toContainEqual(
                expect.objectContaining({ batchId: 'batch-graph', status: 'waiting-for-approval' })
            );
            return { id: input.id };
        });

        try {
            await sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' });

            expect(ordering.slice(0, 2)).toEqual(['confirmation-proposed', 'microtask-after-batch']);
        } finally {
            recordBatchSpy.mockRestore();
        }
    });

    it.each(['plan', 'apply'] as const)(
        'persists an exact paused decision and releases prepared stems in %s mode',
        async (mode) => {
            const action = createStemImportAction(`buffer-decision-${mode}`);
            const providerProposal = {
                ...createProviderProposal(['stem-kick']),
                alternatives: [
                    {
                        id: 'import-as-takes',
                        label: 'Import each stem as a take',
                        changesAuthority: true,
                    },
                ],
            };
            const authority = configurePromptPlanning(action, 'ready', providerProposal);
            let finishCleanup: () => void = () => undefined;
            let markCleanupStarted: () => void = () => undefined;
            const cleanupCompletion = new Promise<void>((resolve) => {
                finishCleanup = resolve;
            });
            const cleanupStarted = new Promise<void>((resolve) => {
                markCleanupStarted = resolve;
            });
            const releasePreparedStems = vi
                .spyOn(preparedStemImportCleanup, 'discardBestEffort')
                .mockImplementation(() => {
                    markCleanupStarted();
                    return cleanupCompletion;
                });
            const expectedMessage =
                mode === 'plan'
                    ? 'Choose one before I continue:\n\n- Import each stem as a take'
                    : 'Choose one before I can prepare this run:\n\n- Import each stem as a take';

            try {
                let resolved = false;
                const pendingDecision = sendChatMessage('Import the prepared stems', { mode }).then(() => {
                    resolved = true;
                });
                await cleanupStarted;

                expect(resolved).toBe(false);
                expect(getPlannedRun()).toMatchObject({
                    decision: null,
                    manualResume: { required: false },
                });
                expect(mocks.updateChatMessage).not.toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({ content: expectedMessage })
                );

                finishCleanup();
                await pendingDecision;

                const run = getPlannedRun();
                expect(run).toMatchObject({
                    phase: 'paused',
                    manualResume: {
                        required: true,
                        reason: 'The alternatives would change the authority or outcome of this run.',
                        workIds: [],
                        requiredAt: expect.any(Number),
                    },
                    decision: {
                        decisionId: expect.any(String),
                        capabilitySchemaIdentity: getPlanningProviderSchemaContract().identity,
                        proposalIdentity: getAgentPlanProposalIdentity({
                            actions: [action],
                            providerProposal,
                            scope: authority.scope,
                            grants: authority.grants,
                        }),
                        revision: 'revision-fixture',
                        scope: authority.scope,
                        grants: authority.grants,
                        alternatives: providerProposal.alternatives,
                        reason: 'The alternatives would change the authority or outcome of this run.',
                        selectedAlternativeId: null,
                        resumeAttemptId: null,
                    },
                    batches: [],
                });
                expect(mocks.executeVersionedCommandBatchEnvelope).not.toHaveBeenCalled();
                expect(mocks.executePlannedActions).not.toHaveBeenCalled();
                expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
                expect(releasePreparedStems).toHaveBeenCalledWith(action.payload.stems, undefined);
                expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({ isStreaming: false, content: expectedMessage })
                );
            } finally {
                releasePreparedStems.mockRestore();
            }
        }
    );

    it.each(['apply', 'plan'] as const)(
        'rejects a mismatched resumed proposal before selecting its source decision and releases the claim in %s mode',
        async (mode) => {
            const action = createAddTrackAction();
            const providerProposal = createProviderProposal([]);
            const authority = configurePromptPlanning(action, 'missing', providerProposal);
            const sourceRunId = `run-resume-source-${mode}`;
            createPendingResumeDecision({
                runId: sourceRunId,
                proposalIdentity: 'mismatched-provider-proposal',
                authority,
                mode,
            });

            await expect(
                agentRunControls.resumeDecision({ runId: sourceRunId, alternativeId: 'add-reference' })
            ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));

            expect(agentRunLifecycle.get(sourceRunId)?.decision).toMatchObject({
                selectedAlternativeId: null,
                resumeAttemptId: null,
            });
            expect(agentRunControls.get(sourceRunId)?.allowedActions.resume).toBe(true);
            expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
            expect(mocks.executePlannedActions).not.toHaveBeenCalled();

            await expect(
                agentRunControls.resumeDecision({ runId: sourceRunId, alternativeId: 'add-reference' })
            ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
            expect(mocks.planPromptActions).toHaveBeenCalledTimes(2);
        }
    );

    it.each(['apply', 'plan'] as const)(
        'selects a resumed source decision only after replacement plan admission succeeds in %s mode',
        async (mode) => {
            const action = createAddTrackAction();
            const providerProposal = createProviderProposal(['unavailable-provider-asset']);
            const authority = configurePromptPlanning(action, 'missing', providerProposal);
            const sourceRunId = `run-resume-plan-rejection-${mode}`;
            createPendingResumeDecision({
                runId: sourceRunId,
                proposalIdentity: getAgentPlanProposalIdentity({
                    actions: [action],
                    providerProposal,
                    scope: authority.scope,
                    grants: authority.grants,
                }),
                authority,
                mode,
            });

            await expect(
                agentRunControls.resumeDecision({ runId: sourceRunId, alternativeId: 'add-reference' })
            ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));

            expect(agentRunLifecycle.get(sourceRunId)?.decision).toMatchObject({
                selectedAlternativeId: null,
                resumeAttemptId: null,
            });
            expect(agentRunControls.get(sourceRunId)?.allowedActions.resume).toBe(true);
            expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
            expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        }
    );

    it.each(['apply', 'plan'] as const)(
        'selects a resumed source decision after the replacement plan is admitted in %s mode',
        async (mode) => {
            const action = createAddTrackAction();
            const providerProposal = createProviderProposal([]);
            const authority = configurePromptPlanning(action, 'missing', providerProposal);
            const sourceRunId = `run-resume-plan-accepted-${mode}`;
            createPendingResumeDecision({
                runId: sourceRunId,
                proposalIdentity: getAgentPlanProposalIdentity({
                    actions: [action],
                    providerProposal,
                    scope: authority.scope,
                    grants: authority.grants,
                }),
                authority,
                mode,
            });

            const result = await agentRunControls.resumeDecision({
                runId: sourceRunId,
                alternativeId: 'add-reference',
            });

            expect(result).toEqual({
                status: 'resumed',
                sourceRunId,
                runId: expect.any(String),
                decisionId: 'decision-reference-track',
                selectedAlternativeId: 'add-reference',
            });
            expect(agentRunLifecycle.get(sourceRunId)?.decision).toMatchObject({
                selectedAlternativeId: 'add-reference',
                resumeAttemptId: null,
            });
            expect(agentRunLifecycle.get(sourceRunId)?.manualResume.required).toBe(false);
            expect(result.status === 'resumed' ? agentRunLifecycle.get(result.runId) : null).toMatchObject({
                phase: mode === 'apply' ? 'waiting-for-approval' : 'completed',
                plan: expect.objectContaining({ revision: 'revision-fixture' }),
            });
        }
    );

    it('awaits accepted plan stem cleanup before publishing the final plan result', async () => {
        const action = createStemImportAction('buffer-plan-cleanup');
        configurePromptPlanning(action, 'ready', createProviderProposal(['stem-kick']));
        let finishCleanup: () => void = () => undefined;
        let markCleanupStarted: () => void = () => undefined;
        const cleanupCompletion = new Promise<void>((resolve) => {
            finishCleanup = resolve;
        });
        const cleanupStarted = new Promise<void>((resolve) => {
            markCleanupStarted = resolve;
        });
        const ordering: string[] = [];
        const releasePreparedStems = vi
            .spyOn(preparedStemImportCleanup, 'discardBestEffort')
            .mockImplementation(async () => {
                ordering.push('cleanup-started');
                markCleanupStarted();
                await cleanupCompletion;
                ordering.push('cleanup-finished');
            });
        mocks.updateChatMessage.mockImplementation((_messageId, update) => {
            // An update may stamp identity alone, with no content.
            if (typeof update.content === 'string' && update.content.startsWith('Planned without changing')) {
                ordering.push('plan-published');
            }
        });

        try {
            let resolved = false;
            const pendingPlan = sendChatMessage('Import the prepared stems', { mode: 'plan' }).then(() => {
                resolved = true;
            });
            await cleanupStarted;

            expect(resolved).toBe(false);
            expect(ordering).toEqual(['cleanup-started']);
            expect(mocks.updateChatMessage).not.toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ content: expect.stringContaining('Planned without changing') })
            );

            finishCleanup();
            await pendingPlan;

            expect(ordering).toEqual(['cleanup-started', 'cleanup-finished', 'plan-published']);
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    content: 'Planned without changing the project:\n\n- Fixture action',
                })
            );
        } finally {
            releasePreparedStems.mockRestore();
        }
    });

    it.each(['apply', 'plan'] as const)(
        'stops an invalid compiled batch before preview, confirmation, or execution in %s mode',
        async (mode) => {
            configurePromptPlanning(createAddTrackAction(), 'missing');
            mocks.parseVersionedCommandBatchEnvelope.mockReturnValue({
                status: 'invalid',
                reason: 'fixture command batch is invalid',
            });

            await sendChatMessage('Add a reference track', { mode });

            expect(getPlannedRun()).toMatchObject({ phase: 'failed', plan: null, batches: [] });
            expect(mocks.executeVersionedCommandBatchEnvelope).not.toHaveBeenCalled();
            expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
            expect(mocks.executePlannedActions).not.toHaveBeenCalled();
            expect(mocks.updateChatMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    isStreaming: false,
                    error: 'fixture command batch is invalid',
                })
            );
        }
    );

    it.each(['apply', 'plan'] as const)(
        'admits application-assigned targets-absent ids without provider-known scope in %s mode',
        async (mode) => {
            const action = createAddTrackAction();
            const providerProposal = createProviderProposal([]);
            const { grants } = configurePromptPlanning(action, 'missing', providerProposal);
            const scope = {
                targetIds: ['track-application-assigned'],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            };
            mocks.compileAgentActionExecution.mockReturnValue({
                commandEnvelopes: [],
                commandBatch: { serialized: '{}', authority: { scope, grants } },
                agentApproval: { policy: { risk: 'confirm', reasons: [] } },
                requiresConfirmation: true,
            });
            mocks.parseVersionedCommandBatchEnvelope.mockReturnValue(
                validParsedBatch({
                    batchId: 'batch-application-assigned',
                    grants,
                    idempotencyKey: 'batch-application-assigned-idempotency',
                    preconditions: [{ kind: 'targets-absent', targetIds: ['track-application-assigned'] }],
                    scope,
                })
            );

            await sendChatMessage('Add a reference track', { mode });

            expect(getPlannedRun()).toMatchObject({
                phase: mode === 'apply' ? 'waiting-for-approval' : 'completed',
                plan: { scope },
                batches:
                    mode === 'apply' ? [{ batchId: 'batch-application-assigned', status: 'waiting-for-approval' }] : [],
            });
            if (mode === 'apply') {
                expect(mocks.proposePendingActionConfirmation).toHaveBeenCalledOnce();
            } else {
                expect(mocks.proposePendingActionConfirmation).not.toHaveBeenCalled();
            }
            expect(mocks.executeVersionedCommandBatchEnvelope).not.toHaveBeenCalled();
            expect(mocks.executePlannedActions).not.toHaveBeenCalled();
        }
    );

    it('forwards a compiler-produced graph and provider-known scope through immediate application', async () => {
        const { commandBatch } = configureCommandGraphForwarding('immediate');
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

    it.each(['committed', 'executed'] as const)(
        'records a durable immediate %s receipt ledger and terminal batch identity',
        async (status) => {
            configureCommandGraphForwarding('immediate');
            mocks.executePlannedActions.mockImplementation(async () => {
                const runId = getMostRecentlyAdmittedRunId();
                return {
                    status,
                    actions: [],
                    receipt: {
                        schemaVersion: 2,
                        runId,
                        batchId: 'batch-graph',
                        outcome: status,
                        pendingEffects: [],
                        links: { render: [], analysis: [] },
                    },
                };
            });

            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeDefined();

            const run = getPlannedRun();
            const receiptIdentity = `2:${run.runId}:batch-graph:${status}`;
            const receiptLedger = [expect.objectContaining({ workId: 'batch-graph', receiptIdentity })];
            const terminalBatch = [
                expect.objectContaining({
                    batchId: 'batch-graph',
                    status: 'committed',
                    receiptIdentity,
                }),
            ];
            expect(run).toMatchObject({
                phase: 'completed',
                receipts: receiptLedger,
                committedWork: receiptLedger,
                batches: terminalBatch,
            });
            const durableRun = JSON.parse(localStorage.getItem('sourdaw-agent-runs') ?? '').json.runs.find(
                (candidate: { runId: string }) => candidate.runId === run.runId
            );
            expect(durableRun).toMatchObject({
                phase: 'completed',
                receipts: receiptLedger,
                committedWork: receiptLedger,
                batches: terminalBatch,
            });
        }
    );

    it('persists the immediate no-op batch terminal status', async () => {
        configureCommandGraphForwarding('immediate');
        mocks.executePlannedActions.mockResolvedValue({ status: 'no-op', actions: [] });

        await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

        const run = getPlannedRun();
        expect(run.batches).toContainEqual(
            expect.objectContaining({ batchId: 'batch-graph', status: 'no-op', receiptIdentity: null })
        );
        const durableRun = JSON.parse(localStorage.getItem('sourdaw-agent-runs') ?? '').json.runs.find(
            (candidate: { runId: string }) => candidate.runId === run.runId
        );
        expect(durableRun.batches).toContainEqual(
            expect.objectContaining({ batchId: 'batch-graph', status: 'no-op', receiptIdentity: null })
        );
    });

    it.each(['committed', 'executed'] as const)(
        'surfaces command lease persistence failure after an immediate %s receipt',
        async (status) => {
            const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
            const settleLease = agentRunWorkLease.settle;
            const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
                if (input.workId === 'batch-graph') {
                    throw storageFailure;
                }
                return settleLease(input);
            });
            configureCommandGraphForwarding('immediate');
            mocks.executePlannedActions.mockImplementation(async () => {
                const runId = getMostRecentlyAdmittedRunId();
                return {
                    status,
                    actions: [],
                    receipt: {
                        schemaVersion: 2,
                        runId,
                        batchId: 'batch-graph',
                        outcome: status,
                        pendingEffects: [],
                        links: { render: [], analysis: [] },
                    },
                };
            });

            try {
                await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeDefined();

                const run = getPlannedRun();
                expect(run.receipts).toContainEqual(expect.objectContaining({ workId: 'batch-graph' }));
                expect(run.committedWork).toContainEqual(expect.objectContaining({ workId: 'batch-graph' }));
                expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        isStreaming: false,
                        error: COMMAND_PERSISTENCE_WARNING,
                        content: expect.stringContaining(COMMAND_PERSISTENCE_WARNING),
                    })
                );
                expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                    expect.any(String),
                    expect.objectContaining({ content: expect.stringContaining('Do not retry automatically') })
                );
            } finally {
                settleWorkLease.mockRestore();
            }
        }
    );

    it.each([
        { outcome: 'success', rejects: false },
        { outcome: 'executor rejection', rejects: true },
    ])('releases immediate command cancellation registration after $outcome', async ({ rejects }) => {
        configureCommandGraphForwarding('immediate');
        const bindAbortController = agentRunCancellation.bindAbortController;
        const releaseCommandCancellation = vi.fn();
        const bindCommandCancellation = vi
            .spyOn(agentRunCancellation, 'bindAbortController')
            .mockImplementation((input) => {
                const release = bindAbortController(input);
                if (input.lease.workId !== 'batch-graph') {
                    return release;
                }
                return () => {
                    releaseCommandCancellation();
                    release();
                };
            });
        if (rejects) {
            mocks.executePlannedActions.mockRejectedValue(new Error('Command execution rejected'));
        } else {
            mocks.executePlannedActions.mockResolvedValue({ status: 'no-op', actions: [] });
        }

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

            expect(releaseCommandCancellation).toHaveBeenCalledOnce();
            expect(mocks.setActiveAborter).toHaveBeenLastCalledWith(null);
        } finally {
            bindCommandCancellation.mockRestore();
        }
    });

    const directReceiptWarningResults = [
        {
            status: 'committed' as const,
            warningField: 'commitWarning' as const,
            warning: 'Project follow-up did not finish.',
            visibleWarning: 'Post-commit project follow-up warning: Project follow-up did not finish.',
        },
        {
            status: 'executed' as const,
            warningField: 'executionWarning' as const,
            warning: 'Runtime follow-up did not finish.',
            visibleWarning: 'Runtime follow-up warning: Runtime follow-up did not finish.',
        },
        {
            status: 'committed' as const,
            warningField: 'reportingWarning' as const,
            warning: 'History reporting did not finish.',
            visibleWarning: 'AI history or notification reporting warning: History reporting did not finish.',
        },
    ] as const;

    it.each(directReceiptWarningResults)(
        'surfaces a direct $status $warningField without inviting automatic retry',
        async ({ status, warningField, warning, visibleWarning }) => {
            configureCommandGraphForwarding('immediate');
            mocks.executePlannedActions.mockImplementation(async () => {
                const runId = getMostRecentlyAdmittedRunId();
                return {
                    status,
                    actions: [],
                    receipt: {
                        schemaVersion: 2,
                        runId,
                        batchId: 'batch-graph',
                        outcome: status,
                        pendingEffects: [],
                        links: { render: [], analysis: [] },
                    },
                    [warningField]: warning,
                };
            });

            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeDefined();

            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    error: visibleWarning,
                    content: expect.stringContaining(visibleWarning),
                })
            );
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({ content: expect.stringContaining('Do not retry automatically') })
            );
        }
    );

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
            settlementWarning: STALE_FAILURE_WARNING,
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
            settlementWarning: null,
        },
    ] as const;

    it.each(immediateFailureResults)(
        'keeps an immediate $status command terminal with its exact terminal command lease',
        async ({
            status,
            reason,
            phase,
            terminalState,
            persistedTerminalState,
            errors,
            content,
            settlementWarning,
        }) => {
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
                    expect.objectContaining({
                        isStreaming: false,
                        error: settlementWarning ? `${reason}\n\n${settlementWarning}` : reason,
                        content: settlementWarning ? `${content}\n\n_${settlementWarning}_` : content,
                    })
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
                    error: `${commandFailure}\n\n${FAILURE_PERSISTENCE_WARNING}`,
                    content: `Failed to execute prompt command atomically: ${commandFailure}\n\n_${FAILURE_PERSISTENCE_WARNING}_`,
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
            expect(JSON.parse(localStorage.getItem('sourdaw-agent-runs') ?? '')).toMatchObject({
                json: {
                    runs: [
                        expect.objectContaining({
                            runId: admittedRunId,
                            phase: 'executing',
                            workLeases: expect.arrayContaining([
                                expect.objectContaining({ workId: 'batch-graph', terminalState: null }),
                            ]),
                        }),
                    ],
                },
            });
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

    it('preserves an immediate execution rejection and exposes its unsettled lease for manual recovery', async () => {
        const executionError = new Error('Command execution rejected');
        const storageFailure = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settleLease = agentRunWorkLease.settle;
        const settleWorkLease = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            if (input.workId === 'batch-graph') {
                throw storageFailure;
            }
            return settleLease(input);
        });
        configureCommandGraphForwarding('immediate');
        mocks.executePlannedActions.mockRejectedValue(executionError);

        try {
            await expect(sendChatMessage(commandGraphFixture.prompt, { mode: 'apply' })).resolves.toBeUndefined();

            const run = getPlannedRun();
            expect(mocks.updateChatMessage).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    error: `${executionError.message}\n\n${FAILURE_PERSISTENCE_WARNING}`,
                    content: expect.stringContaining(FAILURE_PERSISTENCE_WARNING),
                })
            );
            expect(run).toMatchObject({
                phase: 'failed',
                workLeases: [
                    expect.objectContaining({ workId: 'provider-planning', terminalState: 'completed' }),
                    expect.objectContaining({ workId: 'batch-graph', terminalState: null }),
                ],
            });
            await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
                recoveredRunIds: [run.runId],
            });
            expect(agentRunLifecycle.get(run.runId)).toMatchObject({
                phase: 'paused',
                manualResume: { required: true, workIds: ['batch-graph'] },
                workLeases: [
                    expect.anything(),
                    expect.objectContaining({ workId: 'batch-graph', terminalState: 'orphaned' }),
                ],
            });
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: storageFailure,
                    message: 'Failed command work lease settlement failed',
                })
            );
        } finally {
            settleWorkLease.mockRestore();
            loggerError.mockRestore();
        }
    });

    const directTerminalCommandResults = [
        {
            status: 'no-op',
            terminalState: 'completed',
            phase: 'completed',
            content: 'No project changes were needed.',
            settlementWarning: null,
        },
        {
            status: 'cancelled',
            terminalState: 'cancelled',
            phase: 'cancelled',
            content: 'Command cancelled before it committed. No project changes were applied.',
            settlementWarning: STALE_CANCELLATION_WARNING,
        },
    ] as const;

    it.each(directTerminalCommandResults)(
        'settles a direct $status command with its exact $terminalState lease',
        async ({ status, terminalState, phase, content, settlementWarning }) => {
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
                    expect.objectContaining({
                        isStreaming: false,
                        error: settlementWarning ?? undefined,
                        content: settlementWarning ? `${content}\n\n_${settlementWarning}_` : content,
                    })
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
        const { captureProjectIdentity } = await vi.importActual<typeof import('#/modules/CrdtDocument/useCases')>(
            '#/modules/CrdtDocument/useCases'
        );
        mocks.compileAgentActionExecution.mockImplementation(compileAgentActionExecution);
        mocks.parseVersionedCommandBatchEnvelope.mockImplementation(parseVersionedCommandBatchEnvelope);
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: captureProjectIdentity(),
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
