import { parse as parsePersistedValue } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    clearAgentSectionRenderArtifacts,
    getAgentSectionRenderArtifacts,
    getAudioRenderingHandlers,
} from '#/modules/AudioRendering/useCases';
import * as audioRenderingUseCases from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    commandBatchPreviewPort,
    commandRuntimeRepairPort,
    commandBatchPreflightPort,
    configureCommandBatchIdempotency,
    commandProjectDivergencePort,
    getVersionedCommandBatchIdempotentReplay,
    executeAppAction,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
    redo,
    serializeVersionedCommandEnvelope,
    undo,
    commandProjectRevisionPort,
    type executeVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import * as commandUseCases from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    captureUnownedProjectMutations,
    createCommandRecoveryWorkspace,
    createCommandPreviewWorkspace,
    createCrdtDoc,
    getCrdtDocIds,
    mutateCrdtDoc,
    removeCrdtDoc,
    getCrdtDoc,
    inspectAgentProjectDivergence,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction, type AppActionType } from '#/utils/handlerContract';

import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { agentRunStore, readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore, stopGenerating } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
    settlePendingActionResourceLease,
} from '../../stores/pendingActionConfirmationStore';
import { selectAgentRunPendingEffectRecoveries } from '../../stores/selectAgentRunPendingEffectRecoveries';
import { createStemImportConfirmationResourceLease } from '../agentReference/createStemImportConfirmationResourceLease';
import { preparedStemImportResources } from '../agentReference/registerPreparedStemImportResources';
import { AGENT_RUN_STALE_COMPLETION_WARNING } from '../agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { issueAgentCommandApprovalBinding } from '../issueAgentCommandApprovalBinding';
import { recoverAgentRunPendingEffects } from '../recoverAgentRunPendingEffects';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;
type AddDeviceAction = Extract<AppAction, { type: 'addDevice' }>;
type RenderSectionsAction = Extract<AppAction, { type: 'renderProjectSections' }>;
type ConfirmedActionBatchResult = Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
type VerifiedPendingEffect = ReturnType<typeof createVerifiedBatchReceipt>['pendingEffects'][number];

const FAILURE_PERSISTENCE_WARNING =
    'Agent run failure recovery state could not be persisted. The work failed, and no successful artifact is claimed. Review the durable run state before retrying.';
const COMPLETION_PERSISTENCE_WARNING =
    'Agent run completion recovery state could not be persisted. No completed artifact is claimed. Review the durable run state before retrying.';
const STALE_FAILURE_WARNING =
    'Agent work failed after its run lease was cancelled or replaced. No successful artifact is claimed, and the terminal run was not reopened.';
const STALE_RECEIPT_FAILURE_WARNING =
    'Agent work failed after its run lease was cancelled or replaced. The verified failure receipt was retained without reopening the terminal run.';
const STALE_RECEIPT_CANCELLATION_WARNING =
    'Agent work was cancelled after its run lease was cancelled or replaced. The verified cancellation receipt was retained without reopening the terminal run.';
const runtimeMocks = vi.hoisted(() => ({
    applyRuntimeGraphDelta: vi.fn(),
    getRuntimeGraphRevision: vi.fn(() => 4),
    renderOffline: vi.fn(),
}));

function createRuntimeTestTrack(): Track {
    return {
        id: 'track-bass',
        name: 'Bass',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [{ id: 'device-eq', name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: {} }],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

const stemResourceMocks = vi.hoisted(() => ({
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    applyRuntimeGraphDelta: runtimeMocks.applyRuntimeGraphDelta,
    getRuntimeGraphRevision: runtimeMocks.getRuntimeGraphRevision,
    releasePreviewAudioBuffer: stemResourceMocks.releasePreviewAudioBuffer,
    renderOffline: runtimeMocks.renderOffline,
}));
vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: () => ({ releaseStagedAsset: stemResourceMocks.releaseStagedAsset }),
}));

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-confirmed-stems',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-confirmed-stems',
        stems: [
            {
                stemId: 'stem-confirmed-1',
                sourceName: 'Drums.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 10,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'buffer-confirmed-1',
                assetLeaseId: 'lease-confirmed-1',
                trackId: 'track-confirmed-1',
                trackName: 'Drums',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-confirmed-1',
            },
        ],
    },
} satisfies AppAction;

function configureLateSettlementConfirmation(input: {
    runId: string;
    confirmationId: string;
    batchId: string;
    resourceLease?: NonNullable<Parameters<typeof proposePendingActionConfirmation>[0]['resourceLease']>;
    budgets?: Parameters<typeof agentRunLifecycle.create>[0]['budgets'];
}): ReturnType<typeof compileVersionedCommandBatchEnvelope> {
    configureAiWorkflowCommandPreflightFixture('project-1');
    configureCommandBatchIdempotency({ canExecute: () => true });
    const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
    registerHandlerMap({
        setTempo: {
            canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
            execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
            describe: (action) => ({
                label: 'Set tempo',
                inverseAction: {
                    type: 'setTempo',
                    payload: { bpm: 120, expectedBpm: action.payload.bpm },
                },
            }),
            undoable: true,
            validate: () => true,
        },
    });
    const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
    const projectRevision = captureProjectRevision();
    const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
        action,
        expectedEffect: 'Tempo changes to 132 BPM.',
        normalizedProjectRevision: projectRevision,
        options: { groupId: input.batchId, groupLabel: 'Set tempo batch', source: 'prompt' },
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: input.runId,
        batchId: input.batchId,
        projectId: 'project-1',
        baseRevision: projectRevision,
        intent: 'set tempo to 132',
        commands: [serializeVersionedCommandEnvelope(envelope)],
    });
    agentRunLifecycle.create({
        runId: input.runId,
        request: 'set tempo to 132',
        mode: 'macro',
        createdRevision: projectRevision,
        ...(input.budgets ? { budgets: input.budgets } : {}),
    });
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'planning' });
    agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'waiting-for-approval' });
    proposePendingActionConfirmation({
        id: input.confirmationId,
        runId: input.runId,
        prompt: 'set tempo to 132',
        assistantMessageId: 'assistant-1',
        actions: [action],
        actionLabels: ['Set tempo to 132 BPM'],
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        executionMode: 'atomic',
        groupId: input.batchId,
        groupLabel: 'Set tempo batch',
        projectRevision,
        ...(input.resourceLease ? { resourceLease: input.resourceLease } : {}),
    });
    return commandBatch;
}

function createStaleLateBatchResult(input: {
    status: 'ambiguous' | 'cancelled' | 'failed';
    reason: string;
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>;
}): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the late-settlement command batch fixture to remain valid.');
    }
    if (input.status === 'ambiguous') {
        const result: { status: 'ambiguous'; reason: string; actions: [] } = {
            status: 'ambiguous',
            reason: input.reason,
            actions: [],
        };
        return {
            ...result,
            receipt: createVerifiedBatchReceipt({
                contentHash: 'late-settlement-ambiguous',
                envelope: parsed.envelope,
                observedBaseRevision: 'revision-fixture',
                resultingRevision: 'revision-fixture',
                result,
            }),
        };
    }
    if (input.status === 'cancelled') {
        const result: { status: 'cancelled'; reason: string; actions: [] } = {
            status: 'cancelled',
            reason: input.reason,
            actions: [],
        };
        return {
            ...result,
            receipt: createVerifiedBatchReceipt({
                contentHash: 'late-settlement-cancelled',
                envelope: parsed.envelope,
                observedBaseRevision: 'revision-fixture',
                resultingRevision: 'revision-fixture',
                result,
            }),
        };
    }
    const result: { status: 'failed'; reason: string; actions: [] } = {
        status: 'failed',
        reason: input.reason,
        actions: [],
    };
    return {
        ...result,
        receipt: createVerifiedBatchReceipt({
            contentHash: 'late-settlement-failed',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: 'revision-fixture',
            result,
        }),
    };
}

function createWarningBatchResult(input: {
    status: 'committed-with-warning' | 'executed-with-warning';
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>;
}): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the warning-result command batch fixture to remain valid.');
    }
    const result = {
        status: input.status,
        actions: [
            {
                action: { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction,
                label: 'Set tempo to 132 BPM',
            },
        ],
        warning: 'The command completed with a follow-up warning.',
    };
    return {
        ...result,
        receipt: createVerifiedBatchReceipt({
            contentHash: `warning-result-${input.status}`,
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: 'revision-fixture',
            result,
        }),
    };
}

function createPendingRenderBatchResult(
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>
): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the pending-render command batch fixture to remain valid.');
    }
    const commandId = parsed.envelope.commands[0]?.commandId;
    if (!commandId) {
        throw new Error('Expected the pending-render fixture command.');
    }
    const operation = 'renderProjectSections' satisfies AppActionType;
    const pendingEffect = {
        commandId,
        kind: 'external-effect' as const,
        operation,
        reason: 'comparison renderer unavailable',
        remediation: 'reconcile' as const,
        state: 'pending' as const,
    } satisfies VerifiedPendingEffect;
    const result = {
        status: 'committed-with-warning' as const,
        actions: [],
        warning: pendingEffect.reason,
        warningDetails: [{ kind: 'external-effect' as const, message: pendingEffect.reason, pendingEffect }],
    };
    return {
        ...result,
        receipt: createVerifiedBatchReceipt({
            contentHash: 'pending-render-finalization-failure',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: null,
            result,
        }),
    };
}

function createPendingRuntimeGraphBatchResult(
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>
): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the pending runtime-graph command batch fixture to remain valid.');
    }
    const commandId = parsed.envelope.commands[0]?.commandId;
    if (!commandId) {
        throw new Error('Expected the pending runtime-graph fixture command.');
    }
    const operation = 'addDevice' satisfies AppActionType;
    const pendingEffect = {
        commandId,
        kind: 'runtime-graph' as const,
        operation,
        reason: 'runtime graph revision is stale',
        remediation: 'retry' as const,
        state: 'pending' as const,
    } satisfies VerifiedPendingEffect;
    const result = {
        status: 'committed-with-warning' as const,
        actions: [],
        warning: pendingEffect.reason,
        warningDetails: [{ kind: 'external-effect' as const, message: pendingEffect.reason, pendingEffect }],
    };
    return {
        ...result,
        receipt: createVerifiedBatchReceipt({
            contentHash: 'pending-runtime-graph-finalization-failure',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: null,
            result,
        }),
    };
}

function createIdempotentReplayBatchResult(
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>
): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the replay command batch fixture to remain valid.');
    }
    const result: { status: 'executed'; actions: [] } = { status: 'executed', actions: [] };
    return {
        status: 'idempotent-replay',
        actions: [],
        receipt: createVerifiedBatchReceipt({
            contentHash: 'idempotent-replay-stale-settlement',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: 'revision-fixture',
            result,
        }),
    };
}

function createIdempotentReplayNoOpResult(
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>
): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the replay command batch fixture to remain valid.');
    }
    const result: { status: 'no-op'; actions: [] } = { status: 'no-op', actions: [] };
    return {
        status: 'idempotent-replay',
        actions: [],
        receipt: createVerifiedBatchReceipt({
            contentHash: 'idempotent-replay-no-op-stale-settlement',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: 'revision-fixture',
            result,
        }),
    };
}

function createIdempotentReplayFailureResult(input: {
    status: 'ambiguous' | 'failed';
    reason: string;
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>;
}): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the replay command batch fixture to remain valid.');
    }
    if (input.status === 'ambiguous') {
        const result: { status: 'ambiguous'; reason: string; actions: [] } = {
            status: 'ambiguous',
            reason: input.reason,
            actions: [],
        };
        return {
            status: 'idempotent-replay',
            actions: [],
            receipt: createVerifiedBatchReceipt({
                contentHash: 'idempotent-replay-ambiguous-stale-settlement',
                envelope: parsed.envelope,
                observedBaseRevision: 'revision-fixture',
                resultingRevision: 'revision-fixture',
                result,
            }),
        };
    }
    const result: { status: 'failed'; reason: string; actions: [] } = {
        status: 'failed',
        reason: input.reason,
        actions: [],
    };
    return {
        status: 'idempotent-replay',
        actions: [],
        receipt: createVerifiedBatchReceipt({
            contentHash: 'idempotent-replay-failed-stale-settlement',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: 'revision-fixture',
            result,
        }),
    };
}

function createIdempotentReplayCancelledResult(
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>
): ConfirmedActionBatchResult {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') {
        throw new Error('Expected the cancelled replay command batch fixture to remain valid.');
    }
    const result: { status: 'cancelled'; reason: string; actions: [] } = {
        status: 'cancelled',
        reason: 'The prior runtime batch was cancelled.',
        actions: [],
    };
    return {
        status: 'idempotent-replay',
        actions: [],
        receipt: createVerifiedBatchReceipt({
            contentHash: 'idempotent-replay-cancelled-settlement',
            envelope: parsed.envelope,
            observedBaseRevision: 'revision-fixture',
            resultingRevision: 'revision-fixture',
            result,
        }),
    };
}

describe('confirmPendingChatActions transaction admission', () => {
    beforeEach(() => {
        stemResourceMocks.releasePreviewAudioBuffer.mockClear();
        stemResourceMocks.releaseStagedAsset.mockClear();
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        agentRunLifecycle.clear();
        clearPendingActionConfirmations();
        clearAgentSectionRenderArtifacts();
        resetCrdtProjectAuthority('AI confirmation admission');
        createCrdtDoc('independent');
        createCrdtDoc('owned');
        registerCrdtStorageRuntime();
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandBatchPreviewPort.setRecoveryProvider(createCommandRecoveryWorkspace);
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandProjectDivergencePort.setProvider(null);
        commandRuntimeRepairPort.setProvider(null);
        chatStore.set({
            messages: [
                {
                    id: 'assistant-1',
                    role: 'assistant',
                    content: 'Awaiting confirmation',
                    timestamp: 1,
                },
            ],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        resetAiWorkflowCommandPreflightFixture();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        clearAiHistory();
        clearPendingActionConfirmations();
        commandBatchPreviewPort.setProvider(null);
        commandBatchPreviewPort.setRecoveryProvider(null);
        commandProjectRevisionPort.setProvider(null);
        commandProjectDivergencePort.setProvider(null);
        commandRuntimeRepairPort.setProvider(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        removeCrdtDoc('root');
    });

    it('invalidates a confirmed action when the project changes while batch admission is waiting', async () => {
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-admission', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-admission',
            batchId: 'group-admission',
            projectId: captureProjectIdentity(),
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            id: 'confirmation-1',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            projectRevision,
        };
        proposePendingActionConfirmation(proposal);

        let releaseSnapshotTransaction!: () => void;
        let markSnapshotTransactionStarted!: () => void;
        const snapshotTransactionStarted = new Promise<void>((resolve) => {
            markSnapshotTransactionStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseSnapshotTransaction = resolve;
        });
        const blockingTransaction = transactSnapshot(async () => {
            markSnapshotTransactionStarted();
            await release;
        });
        await snapshotTransactionStarted;

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-1' });
        await vi.waitFor(() => expect(getPendingActionConfirmation('confirmation-1')?.status).toBe('accepted'));
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.changedDuringAdmission = true;
            },
        });
        releaseSnapshotTransaction();

        await blockingTransaction;
        await expect(confirmation).resolves.toMatchObject({ status: 'invalidated' });
        expect(execute).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'invalidated',
            content: expect.stringContaining('project changed'),
        });
    });

    // The classifier reports non-overlapping with mayReapply true, but
    // captureProjectMutationAuthorization revokes execution at shouldExecute
    // before allowCompatibleProjectDivergence is consulted, so the commit-time
    // reapply path stays unreachable for confirmed batches.
    it('still fails closed on a foreign write during the admission window even when the divergence classifier would allow a reapply', async () => {
        commandProjectDivergencePort.setProvider(inspectAgentProjectDivergence);
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-admission-reapply', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-admission-reapply',
            batchId: 'group-admission-reapply',
            projectId: captureProjectIdentity(),
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            id: 'confirmation-admission-reapply-1',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            projectRevision,
        };
        proposePendingActionConfirmation(proposal);

        let releaseSnapshotTransaction!: () => void;
        let markSnapshotTransactionStarted!: () => void;
        const snapshotTransactionStarted = new Promise<void>((resolve) => {
            markSnapshotTransactionStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseSnapshotTransaction = resolve;
        });
        const blockingTransaction = transactSnapshot(async () => {
            markSnapshotTransactionStarted();
            await release;
        });
        await snapshotTransactionStarted;

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-admission-reapply-1' });
        await vi.waitFor(() =>
            expect(getPendingActionConfirmation('confirmation-admission-reapply-1')?.status).toBe('accepted')
        );
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.changedDuringAdmission = true;
            },
        });
        releaseSnapshotTransaction();

        await blockingTransaction;
        await expect(confirmation).resolves.toMatchObject({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(execute).not.toHaveBeenCalled();
        expect(getCrdtDoc<{ changedDuringAdmission: boolean }>('independent')).toMatchObject({
            changedDuringAdmission: true,
        });
        expect(undoStore.value?.past).toEqual([]);
    });

    it('keeps the winning same-turn confirmation authoritative when the losing receipt lookup rejects later', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-double-confirm', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'run-double-confirm',
            batchId: 'group-double-confirm',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(command)],
        });
        agentRunLifecycle.create({
            runId: 'run-double-confirm',
            request: 'set tempo to 132',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-double-confirm', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'run-double-confirm', phase: 'waiting-for-approval' });
        const release = vi.fn().mockResolvedValue(undefined);
        proposePendingActionConfirmation({
            id: 'confirmation-double-confirm',
            runId: 'run-double-confirm',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-double-confirm',
            groupLabel: 'Set tempo',
            projectRevision,
            resourceLease: {
                bytes: 1,
                prepareForCommit: vi.fn().mockResolvedValue(undefined),
                commit: vi.fn().mockResolvedValue(undefined),
                release,
                transfer: vi.fn().mockResolvedValue(undefined),
            },
        });
        let resolveWinningEvidence!: (receipt: null) => void;
        let rejectLosingEvidence!: (reason: Error) => void;
        const winningEvidence = new Promise<null>((resolve) => {
            resolveWinningEvidence = resolve;
        });
        const losingEvidence = new Promise<null>((_resolve, reject) => {
            rejectLosingEvidence = reject;
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const replay = vi
            .spyOn(commandUseCases, 'getVersionedCommandBatchIdempotentReplay')
            .mockImplementationOnce(() => winningEvidence)
            .mockImplementationOnce(() => losingEvidence);

        try {
            const first = confirmPendingChatActions({ confirmationId: 'confirmation-double-confirm' });
            const second = confirmPendingChatActions({ confirmationId: 'confirmation-double-confirm' });
            await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
            resolveWinningEvidence(null);
            await expect(first).resolves.toEqual({ status: 'executed' });
            rejectLosingEvidence(new Error('losing receipt read failed after the winning commit'));

            await expect(second).resolves.toEqual({ status: 'not_pending', currentStatus: 'executed' });
        } finally {
            replay.mockRestore();
        }

        expect(execute).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirmation-double-confirm')).toMatchObject({ status: 'executed' });
        expect(agentRunLifecycle.get('run-double-confirm')).toMatchObject({ phase: 'completed', errors: [] });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'executed',
            error: undefined,
        });
    });

    it('keeps an unreadable proposed receipt pending without executing its command batch', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-unreadable-receipt', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'run-unreadable-receipt',
            batchId: 'group-unreadable-receipt',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(command)],
        });
        const chat = chatStore.value;
        if (!chat) {
            throw new Error('Expected the confirmation chat fixture');
        }
        chatStore.set({
            ...chat,
            messages: chat.messages.map((message) =>
                message.id === 'assistant-1' ? { ...message, pendingActionConfirmationStatus: 'proposed' } : message
            ),
        });
        proposePendingActionConfirmation({
            id: 'confirmation-unreadable-receipt',
            runId: 'run-unreadable-receipt',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-unreadable-receipt',
            groupLabel: 'Set tempo',
            projectRevision,
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const replay = vi
            .spyOn(commandUseCases, 'getVersionedCommandBatchIdempotentReplay')
            .mockRejectedValue(new Error('receipt store unavailable'));

        try {
            await expect(
                confirmPendingChatActions({ confirmationId: 'confirmation-unreadable-receipt' })
            ).resolves.toEqual({
                status: 'failed',
                reason: 'The durable commit evidence for the confirmed actions could not be read: receipt store unavailable. The proposal remains pending.',
            });
        } finally {
            replay.mockRestore();
        }

        expect(execute).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirmation-unreadable-receipt')).toMatchObject({ status: 'proposed' });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'proposed',
            content: expect.stringContaining('The confirmed actions were not executed'),
        });
        expect(chatStore.value?.messages[0]?.content).toContain('Project actions were not replayed');
        expect(chatStore.value?.messages[0]?.content).toContain('proposal remains pending');
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
    });

    it('rejects a legacy command-envelope confirmation without an approved outer batch', async () => {
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: (action) => ({
                    label: 'Generic handler label',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes from 120 BPM to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-tempo', groupLabel: 'Set exact tempo', source: 'prompt' },
        });
        proposePendingActionConfirmation({
            id: 'confirmation-envelope',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo from 120 BPM to 128 BPM'],
            commandEnvelopes: [serializeVersionedCommandEnvelope(envelope)],
            executionMode: 'atomic',
            groupId: 'group-tempo',
            groupLabel: 'Set exact tempo',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-envelope' })).resolves.toEqual({
            status: 'failed',
            reason: 'The confirmation has no approved command batch.',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
    });

    it('rejects a raw-action confirmation without an approved outer batch', async () => {
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>();
        registerHandlerMap({
            setTempo: {
                execute,
                describe: () => ({ label: 'Set tempo' }),
                undoable: false,
                validate: () => true,
            },
        });
        const projectRevision = captureProjectRevision();
        proposePendingActionConfirmation({
            id: 'confirmation-raw-action',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            actionLabels: ['Set tempo'],
            executionMode: 'atomic',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-raw-action' })).resolves.toEqual({
            status: 'failed',
            reason: 'The confirmation has no approved command batch.',
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('executes the approved outer command batch instead of the legacy envelope array', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let observedSignal: AbortSignal | undefined;
        const execute = vi.fn((action: SetTempoAction, context?: { signal?: AbortSignal }) => {
            observedSignal = context?.signal;
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-batch', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-batch',
            batchId: 'group-batch',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-batch',
            request: 'set tempo to 132',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-batch', phase: 'planning' });
        agentRunLifecycle.recordBatch({
            runId: 'confirmation-batch',
            batch: {
                batchId: 'group-batch',
                commandIds: [envelope.commandId],
                status: 'waiting-for-approval',
                receiptIdentity: null,
            },
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-batch', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-batch',
            runId: 'confirmation-batch',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandEnvelopes: ['invalid legacy envelope must not execute'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        });

        const leaseSettlementError = new Error('lease persistence failed');
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            throw leaseSettlementError;
        });
        try {
            await expect(confirmPendingChatActions({ confirmationId: 'confirmation-batch' })).resolves.toEqual({
                status: 'executed',
            });
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: leaseSettlementError,
                    message: 'Agent run work lease settlement failed',
                })
            );
            expect(settle).toHaveBeenCalledWith(
                expect.objectContaining({
                    runId: 'confirmation-batch',
                    workId: 'group-batch',
                    leaseId: expect.any(String),
                    receiptIdentity: 'command:confirmation-batch:group-batch',
                    terminalState: 'completed',
                })
            );
            expect(chatStore.value?.messages[0]).toMatchObject({
                error: 'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.',
                pendingActionConfirmationStatus: 'executed',
            });
            expect(chatStore.value?.messages[0]?.content).toContain(
                'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.'
            );
        } finally {
            settle.mockRestore();
            loggerError.mockRestore();
        }
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(observedSignal).toBeInstanceOf(AbortSignal);
        expect(observedSignal?.aborted).toBe(false);
        expect(agentRunLifecycle.get('confirmation-batch')).toMatchObject({
            phase: 'completed',
            batches: [
                expect.objectContaining({
                    batchId: 'group-batch',
                    commandIds: [envelope.commandId],
                    status: 'committed',
                }),
            ],
            receipts: [
                expect.objectContaining({
                    workId: 'group-batch',
                    receiptIdentity: '2:confirmation-batch:group-batch:committed',
                }),
            ],
            committedWork: [
                expect.objectContaining({
                    workId: 'group-batch',
                    receiptIdentity: '2:confirmation-batch:group-batch:committed',
                }),
            ],
            saga: {
                steps: [
                    expect.objectContaining({
                        stepId: 'command:group-batch',
                        owner: 'command',
                        state: 'committed',
                        receiptIdentity: expect.stringContaining('confirmation-batch:group-batch'),
                    }),
                ],
            },
        });

        proposePendingActionConfirmation({
            id: 'confirmation-batch-retry',
            runId: 'confirmation-batch',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        });
        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-batch-retry' })).resolves.toEqual({
            status: 'executed',
        });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(chatStore.value?.messages[0]?.content).toContain('prior verified receipt');
    });

    it.each(['committed-with-warning', 'executed-with-warning'] as const)(
        'settles a $status confirmation with its exact completed command lease',
        async (status) => {
            const runId = `confirmation-${status}-settlement`;
            const confirmationId = `confirmation-${status}-settlement`;
            const batchId = `group-${status}-settlement`;
            const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
            const parsedCommandBatch = parseVersionedCommandBatchEnvelope(
                commandBatch.serialized,
                commandBatch.authority
            );
            if (parsedCommandBatch.status !== 'valid') {
                throw new Error('Expected the warning-result command batch fixture to remain valid.');
            }
            const commandUseCases = await import('#/modules/Command/useCases');
            const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
            const captureMutationAuthorization = vi
                .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
                .mockReturnValue(() => true);
            const execute = vi
                .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
                .mockImplementation(async (input) => {
                    if (status === 'committed-with-warning') {
                        const batchResult = createWarningBatchResult({ status, commandBatch });
                        if (batchResult.status !== 'committed-with-warning') {
                            throw new Error('Expected the committed warning fixture to carry its verified receipt.');
                        }
                        input.options?.onProjectCommitFinalized?.({
                            receipt: batchResult.receipt,
                            revision: 'revision-warning-checkpoint',
                        });
                        return batchResult;
                    }
                    return createWarningBatchResult({ status, commandBatch });
                });
            const settle = vi.spyOn(agentRunWorkLease, 'settle');

            try {
                await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'executed' });

                expect(settle).toHaveBeenCalledWith({
                    runId,
                    workId: batchId,
                    leaseId: `${runId}:${batchId}:0`,
                    cancellationGeneration: 0,
                    idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                    receiptIdentity: `command:${runId}:${batchId}`,
                    terminalState: 'completed',
                });
                expect(execute).toHaveBeenCalledOnce();
                expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
                    status: 'executed',
                    error: 'The command completed with a follow-up warning.',
                    executedActions: [expect.objectContaining({ outcome: status })],
                });
                expect(chatStore.value?.messages[0]).toMatchObject({
                    pendingActionConfirmationStatus: 'executed',
                    error: 'The command completed with a follow-up warning.',
                    content: expect.stringContaining('The command completed with a follow-up warning.'),
                });
            } finally {
                settle.mockRestore();
                execute.mockRestore();
                captureMutationAuthorization.mockRestore();
            }

            expect(agentRunLifecycle.get(runId)).toMatchObject({
                phase: 'completed',
                workLeases: [
                    expect.objectContaining({
                        runId,
                        workId: batchId,
                        terminalState: 'completed',
                    }),
                ],
            });
        }
    );

    it('settles unavailable post-commit evidence without fabricating pending-effect recovery', async () => {
        const runId = 'confirmation-finalization-unavailable';
        const confirmationId = 'confirmation-finalization-unavailable';
        const batchId = 'group-finalization-unavailable';
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockResolvedValue(undefined);
        const commandBatch = configureLateSettlementConfirmation({
            runId,
            confirmationId,
            batchId,
            resourceLease: { bytes: 1, release, retain },
            budgets: { limits: { maxCommands: 1 }, consumed: {} },
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockImplementation(async (input) => {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: 'The project revision provider is unavailable for finalization evidence.',
                });
                return createWarningBatchResult({ status: 'committed-with-warning', commandBatch });
            });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({
                status: 'failed',
                durableCommit: true,
                reason: 'The project revision provider is unavailable for finalization evidence.',
                recovery: { kind: 'inspect-current-project', replay: 'forbidden' },
            });
            expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
                status: 'failed',
                error: 'The project revision provider is unavailable for finalization evidence.',
                followUpProjectRevision: null,
                followUpStatus: null,
            });
            expect(chatStore.value?.messages[0]).toMatchObject({
                pendingActionConfirmationStatus: 'failed',
                content: expect.stringContaining('Inspect the current project state before further automation.'),
            });
            expect(chatStore.value?.messages[0]?.pendingActionFollowUpStatus).toBeUndefined();
            expect(chatStore.value?.messages[0]?.content).not.toContain('manual-repair');
            expect(retain).toHaveBeenCalledOnce();
            expect(release).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get(runId)).toMatchObject({
                budgets: { consumed: { maxCommands: 1 } },
                workLeases: [expect.objectContaining({ workId: batchId, terminalState: 'completed' })],
            });
        } finally {
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }
    });

    it('keeps non-render pending effects on exact-batch reconciliation when finalization evidence is unavailable', async () => {
        const runId = 'confirmation-non-render-finalization-unavailable';
        const confirmationId = 'confirmation-non-render-finalization-unavailable';
        const batchId = 'group-non-render-finalization-unavailable';
        configureAiWorkflowCommandPreflightFixture('project-runtime-finalization');
        configureCommandBatchIdempotency({ canExecute: () => true });
        createCrdtDoc('root');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        resetActionReplayAuthority();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [createRuntimeTestTrack()], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        const action = {
            type: 'addDevice',
            payload: {
                trackId: 'track-bass',
                deviceType: 'builtin-compressor',
                deviceId: 'device-compressor',
                afterDeviceId: 'device-eq',
                expectedDeviceIds: ['device-eq'],
                expectedFrozen: false,
            },
        } satisfies AddDeviceAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Insert the compressor after EQ on Bass.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: batchId, groupLabel: 'Insert compressor', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId,
            batchId,
            projectId: 'project-runtime-finalization',
            baseRevision: projectRevision,
            intent: 'Insert the compressor after EQ on Bass.',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId,
            request: 'Insert the compressor.',
            mode: 'apply',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId, phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: confirmationId,
            runId,
            prompt: 'Insert the compressor.',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Insert compressor after EQ on Bass'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: batchId,
            groupLabel: 'Insert compressor',
            projectRevision,
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockImplementation(async (input) => {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: 'The final project revision is unavailable.',
                });
                return createPendingRuntimeGraphBatchResult(commandBatch);
            });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toMatchObject({
                status: 'failed',
                durableCommit: true,
                effects: [
                    expect.objectContaining({ kind: 'runtime-graph', operation: 'addDevice', remediation: 'retry' }),
                ],
                continuation: { kind: 'manual-repair' },
            });
            expect(execute).toHaveBeenCalled();
        } finally {
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'failed',
            followUpProjectRevision: null,
            followUpStatus: 'failed',
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            pendingActionFollowUpStatus: 'failed',
        });
    });

    it('retains a late committed receipt without reopening a cancelled run or inventing recovery work', async () => {
        const runId = 'confirmation-stale-finalization-unavailable';
        const confirmationId = 'confirmation-stale-finalization-unavailable';
        const batchId = 'group-stale-finalization-unavailable';
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockResolvedValue(undefined);
        const commandBatch = configureLateSettlementConfirmation({
            runId,
            confirmationId,
            batchId,
            resourceLease: { bytes: 1, release, retain },
            budgets: { limits: { maxCommands: 1 }, consumed: {} },
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockImplementation(async (input) => {
                input.options?.onProjectCommitFinalizationUnavailable?.({ reason: 'render artifact vanished' });
                return createPendingRenderBatchResult(commandBatch);
            });
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toMatchObject({
                status: 'failed',
                durableCommit: true,
                reason: expect.stringContaining(AGENT_RUN_STALE_COMPLETION_WARNING),
                recovery: { kind: 'inspect-current-project', replay: 'forbidden' },
            });
        } finally {
            settle.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'cancelled',
            errors: [],
            pendingEffectContinuations: [],
            budgets: { consumed: { maxCommands: 1 } },
            budgetAttempts: [expect.objectContaining({ category: 'maxCommands', actual: 0, final: false })],
            workLeases: [expect.objectContaining({ workId: batchId, terminalState: null })],
        });
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'failed',
            followUpProjectRevision: null,
            followUpStatus: null,
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            content: expect.stringContaining('Do not replay these actions'),
        });
        expect(chatStore.value?.messages[0]?.pendingActionFollowUpStatus).toBeUndefined();
        expect(retain).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
    });

    it('marks a real promoted pending-effect continuation manual when stale lease settlement rejects finalization', async () => {
        const runId = 'confirmation-real-stale-pending-effects';
        const confirmationId = 'confirmation-real-stale-pending-effects';
        const batchId = 'group-real-stale-pending-effects';
        configureAiWorkflowCommandPreflightFixture('project-real-stale-pending-effects');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let injectedForeignMutation = false;
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => {
                    ownedStorage.set({ bpm: action.payload.bpm });
                    return {
                        status: 'written',
                        afterCommit: () => {
                            if (!injectedForeignMutation) {
                                mutateCrdtDoc<Record<string, unknown>>({
                                    id: 'independent',
                                    changeFn: (doc) => {
                                        doc.staleSettlementMutation = true;
                                    },
                                });
                                injectedForeignMutation = true;
                            }
                            return Promise.reject(new Error('tempo runtime unavailable'));
                        },
                        afterAmbiguousCommit: () => Promise.reject(new Error('tempo runtime still unavailable')),
                    };
                },
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: batchId, groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId,
            batchId,
            projectId: 'project-real-stale-pending-effects',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId,
            request: 'set tempo to 132',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId, phase: 'waiting-for-approval' });
        const retain = vi.fn().mockResolvedValue(undefined);
        const release = vi.fn().mockResolvedValue(undefined);
        proposePendingActionConfirmation({
            id: confirmationId,
            runId,
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: batchId,
            groupLabel: 'Set tempo batch',
            projectRevision,
            resourceLease: { bytes: 1, release, retain },
        });
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toMatchObject({
                status: 'failed',
                durableCommit: true,
                reason: expect.stringContaining(AGENT_RUN_STALE_COMPLETION_WARNING),
                recovery: { kind: 'inspect-current-project', replay: 'forbidden' },
            });
        } finally {
            settle.mockRestore();
        }

        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ staleSettlementMutation: true });
        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'cancelled',
            pendingEffectContinuations: [
                expect.objectContaining({
                    batchId,
                    recovery: 'manual-repair',
                    lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
                    effects: [
                        expect.objectContaining({
                            commandId: envelope.commandId,
                            operation: 'setTempo',
                            remediation: 'reconcile',
                            state: 'pending',
                        }),
                    ],
                }),
            ],
            workLeases: [expect.objectContaining({ workId: batchId, terminalState: null })],
        });
        expect(readAgentRunState().pendingEffectRecoveryLedger).toEqual([
            expect.objectContaining({
                runId,
                batchId,
                checkpoint: 'durable',
                recovery: 'manual-repair',
                lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            }),
        ]);
        expect(selectAgentRunPendingEffectRecoveries(readAgentRunState())).toEqual([
            expect.objectContaining({
                runId,
                batchId,
                recovery: 'manual-repair',
                lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            }),
        ]);
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'failed',
            followUpProjectRevision: null,
            followUpStatus: null,
        });
        expect(retain).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
    });

    it('retains a verified receipt without reopening a cancelled run after stale lease settlement', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-stale-settlement', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-stale-settlement',
            batchId: 'group-stale-settlement',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-stale-settlement',
            request: 'set tempo to 132',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-stale-settlement', phase: 'planning' });
        agentRunLifecycle.transitionPhase({
            runId: 'confirmation-stale-settlement',
            phase: 'waiting-for-approval',
        });
        proposePendingActionConfirmation({
            id: 'confirmation-stale-settlement',
            runId: 'confirmation-stale-settlement',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-stale-settlement',
            groupLabel: 'Set tempo batch',
            projectRevision,
        });
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId: 'confirmation-stale-settlement', phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(
                confirmPendingChatActions({ confirmationId: 'confirmation-stale-settlement' })
            ).resolves.toEqual({
                status: 'executed',
            });
        } finally {
            settle.mockRestore();
        }

        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(agentRunLifecycle.get('confirmation-stale-settlement')).toMatchObject({
            phase: 'partially-completed',
            receipts: [
                expect.objectContaining({
                    workId: 'group-stale-settlement',
                    receiptIdentity: expect.stringContaining('confirmation-stale-settlement:group-stale-settlement'),
                }),
            ],
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'executed',
            error: expect.stringContaining('cancelled or replaced'),
            content: expect.stringContaining('durable receipt was retained without reopening the terminal run'),
        });
    });

    const staleLateBatchResults = [
        {
            status: 'failed',
            reason: 'The late command batch failed.',
            content: 'Failed to execute confirmed actions atomically:',
            terminalState: 'failed',
        },
        {
            status: 'ambiguous',
            reason: 'The late command batch is ambiguous.',
            content: 'The confirmed command stopped after an uncertain partial commit:',
            terminalState: 'failed',
        },
    ] satisfies readonly {
        status: 'ambiguous' | 'failed';
        reason: string;
        content: string;
        terminalState: 'failed';
    }[];

    it.each(staleLateBatchResults)(
        'keeps a cancelled run terminal after a stale late $status result',
        async ({ status, reason, content, terminalState }) => {
            const runId = `late-${status}-settlement`;
            const confirmationId = `confirmation-${status}-settlement`;
            const batchId = `group-${status}-settlement`;
            const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
            const parsedCommandBatch = parseVersionedCommandBatchEnvelope(
                commandBatch.serialized,
                commandBatch.authority
            );
            if (parsedCommandBatch.status !== 'valid') {
                throw new Error('Expected the stale late-result command batch fixture to remain valid.');
            }
            const commandUseCases = await import('#/modules/Command/useCases');
            const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
            const captureMutationAuthorization = vi
                .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
                .mockReturnValue(() => true);
            const execute = vi
                .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
                .mockResolvedValue(createStaleLateBatchResult({ status, reason, commandBatch }));
            const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
                agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
                return { status: 'stale' };
            });

            try {
                await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({
                    status: 'failed',
                    reason,
                });
                expect(settle).toHaveBeenCalledWith(
                    expect.objectContaining({ runId, workId: batchId, terminalState: 'failed' })
                );
                expect(settle).toHaveBeenCalledWith({
                    runId,
                    workId: batchId,
                    leaseId: `${runId}:${batchId}:0`,
                    cancellationGeneration: 0,
                    idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                    receiptIdentity: `command:${runId}:${batchId}`,
                    terminalState,
                });
            } finally {
                settle.mockRestore();
                execute.mockRestore();
                captureMutationAuthorization.mockRestore();
            }

            expect(agentRunLifecycle.get(runId)).toMatchObject({
                phase: 'cancelled',
                errors: [],
                pendingEffectContinuations: [],
            });
            expect(chatStore.value?.messages[0]).toMatchObject({
                pendingActionConfirmationStatus: 'failed',
                error: `${reason} ${STALE_FAILURE_WARNING}`,
                content: expect.stringContaining(content),
            });
            expect(chatStore.value?.messages[0]?.content).toContain(STALE_FAILURE_WARNING);
        }
    );

    it('keeps a stale late cancelled result terminal with its cancelled command lease', async () => {
        const runId = 'late-cancelled-settlement';
        const confirmationId = 'confirmation-cancelled-settlement';
        const batchId = 'group-cancelled-settlement';
        const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
        const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedCommandBatch.status !== 'valid') {
            throw new Error('Expected the stale cancelled-result command batch fixture to remain valid.');
        }
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi.spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope').mockResolvedValue(
            createStaleLateBatchResult({
                status: 'cancelled',
                reason: 'The late command batch was cancelled.',
                commandBatch,
            })
        );
        const cancel = vi.spyOn(agentRunCancellation, 'cancel');
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockReturnValue({ status: 'stale' });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({
                status: 'invalidated',
                reason: 'The project changed after this proposal was created. Review and submit the command again.',
            });
            expect(settle).toHaveBeenCalledWith({
                runId,
                workId: batchId,
                leaseId: `${runId}:${batchId}:0`,
                cancellationGeneration: 0,
                idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                receiptIdentity: `command:${runId}:${batchId}`,
                terminalState: 'cancelled',
            });
            expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(settle.mock.invocationCallOrder[0] ?? 0);
        } finally {
            settle.mockRestore();
            cancel.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(agentRunLifecycle.get(runId)).toMatchObject({ phase: 'cancelled', errors: [] });
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'invalidated',
            error: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'invalidated',
            error: 'The project changed after this proposal was created. Review and submit the command again.',
            content: expect.stringContaining('This proposal was not executed because the project changed'),
        });
    });

    it('retains an idempotent replay receipt without reopening a stale cancelled run', async () => {
        const runId = 'idempotent-replay-stale-settlement';
        const confirmationId = 'confirmation-idempotent-replay-stale-settlement';
        const batchId = 'group-idempotent-replay-stale-settlement';
        const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockResolvedValue(createIdempotentReplayBatchResult(commandBatch));
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'executed' });
        } finally {
            settle.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'partially-completed',
            receipts: [
                expect.objectContaining({
                    workId: batchId,
                    receiptIdentity: `2:${runId}:${batchId}:executed`,
                }),
            ],
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'executed',
            error: expect.stringContaining('cancelled or replaced'),
            content: expect.stringContaining('durable receipt was retained without reopening the terminal run'),
        });
    });

    it('records an idempotent committed replay with its owned revert-group receipt binding', async () => {
        const runId = 'idempotent-replay-committed-revert-binding';
        const confirmationId = 'confirmation-idempotent-replay-committed-revert-binding';
        const batchId = 'group-idempotent-replay-committed-revert-binding';
        const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const approval = compileAgentRiskApproval({ commandBatch });
        const approvalBinding = issueAgentCommandApprovalBinding({ approval, commandBatch });
        await expect(
            commandUseCases.executeVersionedCommandBatchEnvelope({
                authority: commandBatch.authority,
                approvalBinding,
                serialized: commandBatch.serialized,
            })
        ).resolves.toMatchObject({ status: 'committed' });
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const claimWorkLease = vi.spyOn(agentRunWorkLease, 'claim');

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'executed' });
        } finally {
            claimWorkLease.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        const receiptIdentity = `2:${runId}:${batchId}:committed`;
        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'completed',
            receipts: [
                expect.objectContaining({
                    workId: batchId,
                    receiptIdentity,
                    revertGroupId: batchId,
                }),
            ],
            committedWork: [
                expect.objectContaining({
                    workId: batchId,
                    receiptIdentity,
                    revertGroupId: batchId,
                }),
            ],
        });
        expect(claimWorkLease).not.toHaveBeenCalled();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'executed',
            content: expect.stringContaining('project batch was already committed'),
        });
    });

    it('keeps a stale replayed no-op cancelled and discards its pending resources', async () => {
        const runId = 'idempotent-replay-no-op-stale-settlement';
        const confirmationId = 'confirmation-idempotent-replay-no-op-stale-settlement';
        const batchId = 'group-idempotent-replay-no-op-stale-settlement';
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockResolvedValue(undefined);
        const commandBatch = configureLateSettlementConfirmation({
            runId,
            confirmationId,
            batchId,
            resourceLease: { bytes: 1, release, retain },
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockResolvedValue(createIdempotentReplayNoOpResult(commandBatch));
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'cancelled' });
        } finally {
            settle.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(agentRunLifecycle.get(runId)).toMatchObject({ phase: 'cancelled', errors: [] });
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'cancelled',
            error: AGENT_RUN_STALE_COMPLETION_WARNING,
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'cancelled',
            error: AGENT_RUN_STALE_COMPLETION_WARNING,
            content: expect.stringContaining('prior verified receipt records a no-op'),
        });
        expect(release).toHaveBeenCalledOnce();
        expect(retain).not.toHaveBeenCalled();
    });

    it('keeps a stale replayed cancellation terminal with cancellation-accurate warning text', async () => {
        const runId = 'idempotent-replay-cancelled-stale-settlement';
        const confirmationId = 'confirmation-idempotent-replay-cancelled-stale-settlement';
        const batchId = 'group-idempotent-replay-cancelled-stale-settlement';
        const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockResolvedValue(createIdempotentReplayCancelledResult(commandBatch));
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'cancelled' });
            expect(settle).toHaveBeenCalledWith(
                expect.objectContaining({ runId, workId: batchId, terminalState: 'cancelled' })
            );
        } finally {
            settle.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'cancelled',
            workLeases: [expect.objectContaining({ workId: batchId, terminalState: null })],
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'cancelled',
            error: STALE_RECEIPT_CANCELLATION_WARNING,
            content: expect.stringContaining(STALE_RECEIPT_CANCELLATION_WARNING),
        });
    });

    const staleReplayFailureResults = [
        {
            status: 'failed',
            reason: 'The prior runtime batch failed.',
            disposition: 'discard',
            content: 'prior verified receipt records that this command batch did not apply successfully',
        },
        {
            status: 'ambiguous',
            reason: 'The prior runtime batch is ambiguous.',
            disposition: 'retain',
            content: 'prior verified receipt records an ambiguous outcome',
        },
    ] satisfies readonly {
        status: 'ambiguous' | 'failed';
        reason: string;
        disposition: 'discard' | 'retain';
        content: string;
    }[];

    it.each(staleReplayFailureResults)(
        'keeps a stale replayed $status receipt cancelled without recording a new failure',
        async ({ status, reason, disposition, content }) => {
            const runId = `idempotent-replay-${status}-stale-settlement`;
            const confirmationId = `confirmation-idempotent-replay-${status}-stale-settlement`;
            const batchId = `group-idempotent-replay-${status}-stale-settlement`;
            const release = vi.fn().mockResolvedValue(undefined);
            const retain = vi.fn().mockResolvedValue(undefined);
            const commandBatch = configureLateSettlementConfirmation({
                runId,
                confirmationId,
                batchId,
                resourceLease: { bytes: 1, release, retain },
            });
            const commandUseCases = await import('#/modules/Command/useCases');
            const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
            const captureMutationAuthorization = vi
                .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
                .mockReturnValue(() => true);
            const execute = vi
                .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
                .mockResolvedValue(createIdempotentReplayFailureResult({ status, reason, commandBatch }));
            const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
                agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
                return { status: 'stale' };
            });

            try {
                await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({
                    status: 'failed',
                    reason,
                });
                expect(settle).toHaveBeenCalledWith(
                    expect.objectContaining({ runId, workId: batchId, terminalState: 'failed' })
                );
            } finally {
                settle.mockRestore();
                execute.mockRestore();
                captureMutationAuthorization.mockRestore();
            }

            expect(agentRunLifecycle.get(runId)).toMatchObject({
                phase: 'cancelled',
                errors: [],
                workLeases: [expect.objectContaining({ workId: batchId, terminalState: null })],
            });
            expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
                status: 'failed',
                error: `${reason} ${STALE_RECEIPT_FAILURE_WARNING}`,
            });
            expect(chatStore.value?.messages[0]).toMatchObject({
                pendingActionConfirmationStatus: 'failed',
                error: `${reason} ${STALE_RECEIPT_FAILURE_WARNING}`,
                content: expect.stringContaining(content),
            });
            expect(chatStore.value?.messages[0]?.content).toContain(STALE_RECEIPT_FAILURE_WARNING);
            if (disposition === 'retain') {
                expect(retain).toHaveBeenCalledOnce();
                expect(release).not.toHaveBeenCalled();
            } else {
                expect(release).toHaveBeenCalledOnce();
                expect(retain).not.toHaveBeenCalled();
            }
        }
    );

    const freshReplayTerminalResults = [
        { outcome: 'executed', terminalState: 'completed', resultStatus: 'executed', phase: 'completed' },
        { outcome: 'no-op', terminalState: 'completed', resultStatus: 'executed', phase: 'completed' },
        { outcome: 'failed', terminalState: 'failed', resultStatus: 'failed', phase: 'failed' },
        { outcome: 'ambiguous', terminalState: 'failed', resultStatus: 'failed', phase: 'failed' },
        { outcome: 'cancelled', terminalState: 'cancelled', resultStatus: 'cancelled', phase: 'cancelled' },
    ] as const;

    it.each(freshReplayTerminalResults)(
        'settles a fresh replayed $outcome receipt as $terminalState',
        async ({ outcome, terminalState, resultStatus, phase }) => {
            const runId = `idempotent-replay-${outcome}-fresh-settlement`;
            const confirmationId = `confirmation-idempotent-replay-${outcome}-fresh-settlement`;
            const batchId = `group-idempotent-replay-${outcome}-fresh-settlement`;
            const commandBatch = configureLateSettlementConfirmation({ runId, confirmationId, batchId });
            const commandUseCases = await import('#/modules/Command/useCases');
            const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
            const captureMutationAuthorization = vi
                .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
                .mockReturnValue(() => true);
            let replayResult: ConfirmedActionBatchResult;
            if (outcome === 'executed') {
                replayResult = createIdempotentReplayBatchResult(commandBatch);
            } else if (outcome === 'no-op') {
                replayResult = createIdempotentReplayNoOpResult(commandBatch);
            } else if (outcome === 'cancelled') {
                replayResult = createIdempotentReplayCancelledResult(commandBatch);
            } else {
                replayResult = createIdempotentReplayFailureResult({
                    status: outcome,
                    reason: `The prior runtime batch is ${outcome}.`,
                    commandBatch,
                });
            }
            const execute = vi
                .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
                .mockResolvedValue(replayResult);
            const settle = vi.spyOn(agentRunWorkLease, 'settle');

            try {
                await expect(confirmPendingChatActions({ confirmationId })).resolves.toMatchObject({
                    status: resultStatus,
                });
                expect(settle).toHaveBeenCalledWith(expect.objectContaining({ runId, workId: batchId, terminalState }));
            } finally {
                settle.mockRestore();
                execute.mockRestore();
                captureMutationAuthorization.mockRestore();
            }

            expect(agentRunLifecycle.get(runId)).toMatchObject({
                phase,
                workLeases: [expect.objectContaining({ workId: batchId, terminalState })],
            });
        }
    );

    it('keeps a stale late no-op cancelled instead of claiming fresh completion', async () => {
        const runId = 'late-no-op-settlement';
        const confirmationId = 'confirmation-no-op-settlement';
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockResolvedValue(undefined);
        const commandBatch = configureLateSettlementConfirmation({
            runId,
            confirmationId,
            batchId: 'group-no-op-settlement',
            resourceLease: { bytes: 1, release, retain },
        });
        const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedCommandBatch.status !== 'valid') {
            throw new Error('Expected the stale no-op command batch fixture to remain valid.');
        }
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockResolvedValue({ status: 'no-op', actions: [] });
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            agentRunLifecycle.transitionPhase({ runId, phase: 'cancelled' });
            return { status: 'stale' };
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'cancelled' });
            expect(settle).toHaveBeenCalledWith({
                runId,
                workId: 'group-no-op-settlement',
                leaseId: `${runId}:group-no-op-settlement:0`,
                cancellationGeneration: 0,
                idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                receiptIdentity: `command:${runId}:group-no-op-settlement`,
                terminalState: 'completed',
            });
        } finally {
            settle.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(agentRunLifecycle.get(runId)).toMatchObject({ phase: 'cancelled' });
        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'cancelled',
            error: expect.stringContaining('cancelled or replaced'),
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'cancelled',
            error: expect.stringContaining('cancelled or replaced'),
            content: expect.stringContaining('No project changes were needed after confirmation'),
        });
        expect(release).toHaveBeenCalledOnce();
        expect(retain).not.toHaveBeenCalled();
    });

    it('preserves a confirmed no-op while surfacing lease settlement persistence failure', async () => {
        const runId = 'late-no-op-persistence';
        const confirmationId = 'confirmation-no-op-persistence';
        const batchId = 'group-no-op-persistence';
        configureLateSettlementConfirmation({ runId, confirmationId, batchId });
        agentRunLifecycle.recordBatch({
            runId,
            batch: { batchId, commandIds: [], status: 'waiting-for-approval', receiptIdentity: null },
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockResolvedValue({ status: 'no-op', actions: [] });
        const settleLease = agentRunWorkLease.settle;
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
            settleLease(input);
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'executed' });
        } finally {
            settle.mockRestore();
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }

        expect(getPendingActionConfirmation(confirmationId)).toMatchObject({
            status: 'executed',
            error: COMPLETION_PERSISTENCE_WARNING,
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'executed',
            error: COMPLETION_PERSISTENCE_WARNING,
            content: `No project changes were needed after confirmation. ${COMPLETION_PERSISTENCE_WARNING}`,
        });
        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'completed',
            batches: [expect.objectContaining({ batchId, status: 'no-op' })],
            workLeases: [expect.objectContaining({ workId: batchId, terminalState: 'completed' })],
        });
    });

    it('keeps a batch execution failure authoritative when error-path lease settlement throws', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        registerHandlerMap({
            setTempo: {
                execute: () => undefined,
                describe: () => ({ label: 'Set tempo' }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-error-path', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-error-path',
            batchId: 'group-error-path',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-error-path',
            request: 'set tempo to 132',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-error-path', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-error-path', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-error-path',
            runId: 'confirmation-error-path',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-error-path',
            groupLabel: 'Set tempo batch',
            projectRevision,
        });
        const batchExecutionError = new Error('Tempo engine unavailable');
        const leaseSettlementError = new Error('lease persistence failed');
        const commandUseCases = await import('#/modules/Command/useCases');
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockRejectedValue(batchExecutionError);
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const settle = vi.spyOn(agentRunWorkLease, 'settle').mockImplementation(() => {
            throw leaseSettlementError;
        });

        try {
            await expect(confirmPendingChatActions({ confirmationId: 'confirmation-error-path' })).resolves.toEqual({
                status: 'failed',
                reason: 'Tempo engine unavailable',
            });
            expect(loggerError).toHaveBeenCalledWith(
                expect.objectContaining({
                    cause: leaseSettlementError,
                    message: 'Agent run work lease settlement failed',
                })
            );
            expect(settle).toHaveBeenCalledWith(
                expect.objectContaining({
                    runId: 'confirmation-error-path',
                    workId: 'group-error-path',
                    leaseId: expect.any(String),
                    receiptIdentity: 'command:confirmation-error-path:group-error-path',
                    terminalState: 'failed',
                })
            );
            expect(chatStore.value?.messages[0]).toMatchObject({
                error: `Tempo engine unavailable ${FAILURE_PERSISTENCE_WARNING}`,
                pendingActionConfirmationStatus: 'failed',
            });
            expect(chatStore.value?.messages[0]?.content).toContain('Tempo engine unavailable');
            expect(chatStore.value?.messages[0]?.content).toContain(FAILURE_PERSISTENCE_WARNING);
            expect(agentRunLifecycle.get('confirmation-error-path')).toMatchObject({
                phase: 'failed',
                workLeases: [expect.objectContaining({ workId: 'group-error-path', terminalState: null })],
            });
        } finally {
            settle.mockRestore();
            loggerError.mockRestore();
            execute.mockRestore();
        }
    });

    it('releases commit-protected resources when the storage transaction proves noncommit', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-storage-failure', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-storage-failure',
            batchId: 'group-storage-failure',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(command)],
        });
        const prepareForCommit = vi.fn().mockResolvedValue(undefined);
        const protect = vi.fn();
        const commit = vi.fn().mockResolvedValue(undefined);
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockResolvedValue(undefined);
        const transfer = vi.fn().mockResolvedValue(undefined);
        proposePendingActionConfirmation({
            id: 'confirmation-storage-failure',
            runId: 'confirmation-storage-failure',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-storage-failure',
            groupLabel: 'Set tempo batch',
            projectRevision,
            resourceLease: { bytes: 1, prepareForCommit, protect, commit, release, retain, transfer },
        });
        configureAutomergeStoragePort({
            getDoc: () => ({}),
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: () => {
                throw new Error('storage commit rejected');
            },
        });

        try {
            await expect(
                confirmPendingChatActions({ confirmationId: 'confirmation-storage-failure' })
            ).resolves.toMatchObject({ status: 'failed', reason: 'storage commit rejected' });
            expect(prepareForCommit).toHaveBeenCalledOnce();
            expect(protect).toHaveBeenCalledOnce();
            expect(commit).not.toHaveBeenCalled();
            expect(retain).not.toHaveBeenCalled();
            expect(transfer).not.toHaveBeenCalled();
            expect(release).toHaveBeenCalledOnce();
        } finally {
            await settlePendingActionResourceLease({
                confirmationId: 'confirmation-storage-failure',
                disposition: 'retain',
            });
        }
    });

    it.each([
        { outcome: 'verified-after-abort', createsTargets: true },
        { outcome: 'ambiguous', createsTargets: false },
    ] as const)('settles confirmed stem resources for $outcome command truth', async ({ outcome, createsTargets }) => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        let targetsCreated = false;
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: ['buffer-confirmed-1'],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: targetsCreated
                ? Object.fromEntries(targetIds.map((targetId) => [targetId, targetId]))
                : {},
        }));
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ imported: boolean }>('owned', 'stemImport');
        let markAfterCommitStarted!: () => void;
        let releaseAfterCommit!: () => void;
        const afterCommitStarted = new Promise<void>((resolve) => {
            markAfterCommitStarted = resolve;
        });
        const afterCommitRelease = new Promise<void>((resolve) => {
            releaseAfterCommit = resolve;
        });
        const afterCommit = () => {
            markAfterCommitStarted();
            return afterCommitRelease;
        };
        const discardStemAction = {
            type: 'discardImportedStemSet',
            payload: {
                folderId: stemAction.payload.folderId,
                stemTrackIds: stemAction.payload.stems.map((stem) => stem.trackId),
                guards: [],
            },
        } satisfies AppAction;
        registerHandlerMap({
            importStemSet: {
                execute: () => {
                    targetsCreated = createsTargets;
                    ownedStorage.set({ imported: true });
                    return {
                        status: 'written',
                        afterCommit,
                        afterAmbiguousCommit: () => undefined,
                    };
                },
                canReapplyAfterDivergence: () => true,
                describe: () => ({ label: 'Import confirmed stems', inverseAction: discardStemAction }),
                requiresAbortCompensation: false,
                undoable: true,
                validate: () => true,
            },
            discardImportedStemSet: {
                execute: () => ownedStorage.set({ imported: false }),
                canReapplyAfterDivergence: () => true,
                describe: () => ({ label: 'Discard confirmed stems', inverseAction: stemAction }),
                undoable: true,
                validate: () => true,
            },
        });
        const projectRevision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: stemAction,
            expectedEffect: 'Import the exact confirmed stem set.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-confirmed-stems', groupLabel: 'Import confirmed stems', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'run-confirmed-stems',
            batchId: 'group-confirmed-stems',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'Import confirmed stems',
            commands: [serializeVersionedCommandEnvelope(command)],
        });
        agentRunLifecycle.create({
            runId: 'run-confirmed-stems',
            request: 'Import confirmed stems',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-confirmed-stems', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'run-confirmed-stems', phase: 'waiting-for-approval' });
        preparedStemImportResources.register({ runId: 'run-confirmed-stems', stems: stemAction.payload.stems });
        proposePendingActionConfirmation({
            id: 'confirmation-confirmed-stems',
            runId: 'run-confirmed-stems',
            prompt: 'Import confirmed stems',
            assistantMessageId: 'assistant-1',
            actions: [stemAction],
            actionLabels: ['Import confirmed stems'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-confirmed-stems',
            groupLabel: 'Import confirmed stems',
            projectRevision,
            resourceLease: createStemImportConfirmationResourceLease('run-confirmed-stems', [stemAction], {
                batchId: 'group-confirmed-stems',
                commandBatch,
            }),
        });

        const retainPreparedResources =
            outcome === 'ambiguous' ? vi.spyOn(preparedStemImportResources, 'retainForRecovery') : null;
        const discardPreparedResources =
            outcome === 'ambiguous' ? vi.spyOn(preparedStemImportResources, 'discard') : null;
        const reconcilePreparedResources =
            outcome === 'ambiguous' ? vi.spyOn(preparedStemImportResources, 'reconcile') : null;
        const settleWorkLease =
            outcome === 'ambiguous'
                ? vi.spyOn(agentRunWorkLease, 'settle').mockImplementation((input) => {
                      agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'cancelled' });
                      return { status: 'stale' };
                  })
                : null;
        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-confirmed-stems' });
        if (outcome === 'ambiguous') {
            try {
                const result = await confirmation;
                expect(result).toMatchObject({ status: 'failed' });
                expect('reason' in result ? result.reason : '').toContain(
                    'Automerge storage transaction committed before a later document failed'
                );
                expect(agentRunLifecycle.get('run-confirmed-stems')).toMatchObject({
                    phase: 'cancelled',
                    errors: [],
                    temporaryAssets: [
                        expect.objectContaining({ assetId: 'buffer-confirmed-1', status: 'cleanup-pending' }),
                    ],
                });
                expect(retainPreparedResources).toHaveBeenCalledOnce();
                expect(discardPreparedResources).not.toHaveBeenCalled();
                expect(reconcilePreparedResources).toHaveBeenCalledWith({
                    runId: 'run-confirmed-stems',
                    batchId: 'group-confirmed-stems',
                    getVerifiedReceipt: expect.any(Function),
                });
                expect(stemResourceMocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
                expect(stemResourceMocks.releaseStagedAsset).not.toHaveBeenCalled();
            } finally {
                settleWorkLease?.mockRestore();
                retainPreparedResources?.mockRestore();
                discardPreparedResources?.mockRestore();
                reconcilePreparedResources?.mockRestore();
            }
            return;
        }
        await Promise.race([
            afterCommitStarted,
            confirmation.then((result) => {
                throw new Error(`Confirmed stem command settled before post-commit effects: ${JSON.stringify(result)}`);
            }),
        ]);
        stopGenerating();
        await agentRunCancellation.cancel({
            runId: 'run-confirmed-stems',
            reason: 'Test observes cancellation during post-commit effects.',
        });
        let cancellationAssertionError: Error | null = null;
        try {
            expect(agentRunLifecycle.get('run-confirmed-stems')?.temporaryAssets).toEqual([
                expect.objectContaining({ assetId: 'buffer-confirmed-1', status: 'cleanup-pending' }),
            ]);
            expect(stemResourceMocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(stemResourceMocks.releaseStagedAsset).not.toHaveBeenCalled();
        } catch (error) {
            cancellationAssertionError = error instanceof Error ? error : new Error(String(error));
        } finally {
            releaseAfterCommit();
        }
        await expect(confirmation).resolves.toEqual({ status: 'executed' });
        if (cancellationAssertionError) {
            throw cancellationAssertionError;
        }
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ stemImport: { imported: true } });
        expect(stemResourceMocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(stemResourceMocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('run-confirmed-stems')?.temporaryAssets).toEqual([]);
    });

    it('delegates proven non-commit settlement to the prepared-stem owner', async () => {
        const runId = 'run-confirmed-stems-discard';
        const confirmationId = 'confirmation-confirmed-stems-discard';
        const projectRevision = captureProjectRevision();
        agentRunLifecycle.create({
            runId,
            request: 'Import confirmed stems',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        preparedStemImportResources.register({ runId, stems: stemAction.payload.stems });
        proposePendingActionConfirmation({
            id: confirmationId,
            runId,
            prompt: 'Import confirmed stems',
            assistantMessageId: 'assistant-1',
            actions: [stemAction],
            actionLabels: ['Import confirmed stems'],
            projectRevision,
            resourceLease: createStemImportConfirmationResourceLease(runId, [stemAction]),
        });

        settlePendingActionResourceLease({ confirmationId, disposition: 'discard' });

        await vi.waitFor(() => expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]));
        expect(stemResourceMocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('buffer-confirmed-1');
        expect(stemResourceMocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('lease-confirmed-1');
    });

    it('uses the approved batch identity through failed recovery when confirmation group ID differs', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const executeBatch = vi.spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope');
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let effectAttempts = 0;
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => {
                    ownedStorage.set({ bpm: action.payload.bpm });
                    const applyRuntimeEffect = () => {
                        effectAttempts += 1;
                        if (effectAttempts <= 2) {
                            return Promise.reject(new Error('tempo runtime unavailable'));
                        }
                        return Promise.resolve();
                    };
                    return {
                        status: 'written',
                        afterCommit: applyRuntimeEffect,
                        afterAmbiguousCommit: applyRuntimeEffect,
                    };
                },
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-recovery-batch', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-recovery-batch',
            batchId: 'group-recovery-batch',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            runId: 'confirmation-recovery-batch',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            groupId: 'untrusted-confirmation-group',
            groupLabel: 'Set tempo batch',
            projectRevision,
        };
        agentRunLifecycle.create({
            runId: 'confirmation-recovery-batch',
            request: proposal.prompt,
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-recovery-batch', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-recovery-batch', phase: 'waiting-for-approval' });
        const prepareForCommit = vi.fn().mockResolvedValue(undefined);
        const commit = vi.fn().mockResolvedValue(undefined);
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockRejectedValue(new Error('promotion remains pending'));
        proposePendingActionConfirmation({
            ...proposal,
            id: 'confirmation-recovery-batch',
            resourceLease: { bytes: 1, prepareForCommit, commit, release, retain },
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch' })
        ).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
            effects: [expect.objectContaining({ kind: 'external-effect', remediation: 'reconcile' })],
            continuation: { kind: 'manual-repair' },
        });
        expect(effectAttempts).toBe(2);
        expect(prepareForCommit).toHaveBeenCalledOnce();
        expect(commit).toHaveBeenCalledOnce();
        expect(retain).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
        expect(prepareForCommit.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]!);
        expect(commit.mock.invocationCallOrder[0]).toBeLessThan(retain.mock.invocationCallOrder[0]!);
        expect(executeBatch).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({ groupId: 'group-recovery-batch' }),
            })
        );

        const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        if (!priorReceipt) {
            throw new Error('Expected the partially committed command receipt to remain available for recovery.');
        }
        expect(priorReceipt.batchId).toBe('group-recovery-batch');
        const recoveryReason = 'Recovery resource preparation failed.';
        const recoveryPrepareForCommit = vi.fn().mockRejectedValue(new Error(recoveryReason));
        proposePendingActionConfirmation({
            ...proposal,
            id: 'confirmation-recovery-batch-preparation-failure',
            resourceLease: {
                bytes: 1,
                prepareForCommit: recoveryPrepareForCommit,
                commit: vi.fn().mockResolvedValue(undefined),
                release: vi.fn().mockResolvedValue(undefined),
                retain: vi.fn().mockResolvedValue(undefined),
            },
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch-preparation-failure' })
        ).resolves.toEqual({
            status: 'failed',
            durableCommit: true,
            reason: recoveryReason,
            effects: [...priorReceipt.pendingEffects],
            continuation: {
                authority: 'authoritative-collaboration-host',
                idempotency: 'project-checkpoint',
                kind: 'manual-repair',
            },
        });
        expect(recoveryPrepareForCommit).toHaveBeenCalledOnce();
        expect(getPendingActionConfirmation('confirmation-recovery-batch-preparation-failure')).toMatchObject({
            status: 'failed',
            error: recoveryReason,
        });
        expect(chatStore.value?.messages.find((message) => message.id === 'assistant-1')).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            error: recoveryReason,
            content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${recoveryReason}`,
        });
        expect(agentRunLifecycle.get('confirmation-recovery-batch')).toMatchObject({
            committedWork: [
                expect.objectContaining({
                    workId: 'group-recovery-batch',
                    revertGroupId: 'group-recovery-batch',
                }),
            ],
            receipts: [
                expect.objectContaining({
                    workId: 'group-recovery-batch',
                    receiptIdentity: expect.stringContaining('confirmation-recovery-batch:group-recovery-batch'),
                }),
            ],
        });

        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-recovery-batch-retry' });
        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch-retry' })
        ).resolves.toEqual({
            status: 'failed',
            durableCommit: true,
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            effects: [...priorReceipt.pendingEffects],
            continuation: {
                authority: 'authoritative-collaboration-host',
                idempotency: 'project-checkpoint',
                kind: 'manual-repair',
            },
        });

        expect(agentRunLifecycle.get('confirmation-recovery-batch')).toMatchObject({
            committedWork: [
                expect.objectContaining({
                    workId: 'group-recovery-batch',
                    revertGroupId: 'group-recovery-batch',
                }),
            ],
        });

        expect(effectAttempts).toBe(2);
        expect(chatStore.value?.messages[0]?.content).toContain('pending-effect reconciliation is still incomplete');
        expect(chatStore.value?.messages[0]?.content).toContain(MISSING_EXACT_CHECKPOINT_RECOVERY_REASON);
        expect(chatStore.value?.messages[0]?.content).not.toContain('without replaying project or runtime effects');
        expect(chatStore.value?.messages[0]?.content).not.toContain('tempo runtime unavailable');
        executeBatch.mockRestore();
    });

    it('preserves a failed verified receipt on retry instead of reporting the batch already applied', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const execute = vi.fn(() => {
            throw new Error('Tempo engine unavailable');
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-failed-batch', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-failed-batch',
            batchId: 'group-failed-batch',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        const proposal = {
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            groupId: 'group-failed-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        };
        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-failed-batch' });

        const first = await confirmPendingChatActions({ confirmationId: 'confirmation-failed-batch' });
        expect(first).toMatchObject({ status: 'failed' });
        if (first.status !== 'failed') {
            throw new Error('Expected the first command batch to fail');
        }
        const executionCallsAfterFirstFailure = execute.mock.calls.length;

        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-failed-batch-retry' });
        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-failed-batch-retry' })).resolves.toEqual(
            first
        );
        expect(execute).toHaveBeenCalledTimes(executionCallsAfterFirstFailure);
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            content: expect.not.stringContaining('already applied'),
        });
    });

    it('classifies approval-time divergence and issues a fresh revision-bound approval before execution', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        const validate = vi.fn(() => true);
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate,
            },
        });
        const action = {
            type: 'setTempo',
            payload: { bpm: 132 },
        } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        agentRunLifecycle.create({
            runId: 'confirmation-reapproval',
            request: 'set tempo to 132',
            mode: 'apply',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'confirmation-reapproval',
            phase: 'planning',
            revision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: 'confirmation-reapproval',
            phase: 'waiting-for-approval',
            revision: projectRevision,
        });
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes from 120 BPM to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-reapproval', groupLabel: 'Set tempo batch', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-reapproval',
            batchId: 'group-reapproval',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        proposePendingActionConfirmation({
            id: 'confirmation-reapproval',
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo from 120 BPM to 132 BPM'],
            commandEnvelopes: [serializeVersionedCommandEnvelope(envelope)],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-reapproval',
            groupLabel: 'Set tempo batch',
            projectRevision,
            runId: 'confirmation-reapproval',
        });
        const classify = vi.fn(() => ({
            kind: 'non-overlapping' as const,
            mayReapply: true,
            repairCandidates: [],
            targetIds: [] as string[],
        }));
        commandProjectDivergencePort.setProvider(classify);
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.collaboratorChange = true;
            },
        });
        const currentRevision = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-reapproval' })).resolves.toMatchObject({
            divergence: { kind: 'non-overlapping', mayReapply: true },
            status: 'reapproval_required',
        });
        expect(execute).not.toHaveBeenCalled();
        expect(validate).toHaveBeenCalledOnce();
        expect(classify).toHaveBeenCalledWith(
            expect.objectContaining({
                baseRevision: projectRevision,
                commandsCompatible: true,
                targetIds: expect.arrayContaining(['@project/transport/tempo']),
            })
        );
        expect(getPendingActionConfirmation('confirmation-reapproval')).toMatchObject({
            approvalSnapshot: {
                agentApproval: { sourceRevision: currentRevision },
                commandBatch: { authority: { baseRevision: currentRevision } },
            },
            projectRevision: currentRevision,
            status: 'proposed',
        });
        expect(agentRunLifecycle.get('confirmation-reapproval')?.revisions.approved).toBeNull();

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-reapproval' })).resolves.toEqual({
            status: 'executed',
        });
        expect(agentRunLifecycle.get('confirmation-reapproval')?.revisions.approved).toBe(currentRevision);
        expect(agentRunLifecycle.get('confirmation-reapproval')?.workLeases).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ workId: 'group-reapproval', terminalState: 'completed' }),
            ])
        );
        expect(execute).toHaveBeenCalledOnce();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
    });

    it('surfaces a durable add-device runtime failure and fails recovery without exact checkpoint binding', async () => {
        runtimeMocks.applyRuntimeGraphDelta.mockReset();
        const rejectedRuntimeDelta = {
            acceptance: 'rejected' as const,
            application: 'not-applied' as const,
            reason: 'runtime graph revision is stale',
        };
        const appliedRuntimeDelta = {
            acceptance: 'accepted' as const,
            application: 'applied' as const,
        };
        runtimeMocks.applyRuntimeGraphDelta
            .mockReturnValueOnce(rejectedRuntimeDelta)
            .mockReturnValue(appliedRuntimeDelta);
        const repairRuntimeFromCurrentProject = vi.fn();
        commandRuntimeRepairPort.setProvider(repairRuntimeFromCurrentProject);
        resetAiWorkflowCommandPreflightFixture();
        configureAiWorkflowCommandPreflightFixture('project-runtime-effect');
        configureCommandBatchIdempotency({ canExecute: () => true });
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [createRuntimeTestTrack()],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        const action = {
            type: 'addDevice',
            payload: {
                trackId: 'track-bass',
                deviceType: 'builtin-compressor',
                deviceId: 'device-compressor',
                afterDeviceId: 'device-eq',
                expectedDeviceIds: ['device-eq'],
                expectedFrozen: false,
            },
        } satisfies AddDeviceAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Insert the compressor after EQ on Bass.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-runtime-effect', groupLabel: 'Insert compressor', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'run-runtime-effect',
            batchId: 'group-runtime-effect',
            projectId: 'project-runtime-effect',
            baseRevision: projectRevision,
            intent: 'Insert the compressor after EQ on Bass.',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        agentRunLifecycle.create({
            runId: 'run-runtime-effect',
            request: 'Insert the compressor after EQ on Bass.',
            mode: 'apply',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-runtime-effect', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'run-runtime-effect', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-runtime-effect',
            runId: 'run-runtime-effect',
            prompt: 'Insert the compressor after EQ on Bass.',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Insert compressor after EQ on Bass'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-runtime-effect',
            groupLabel: 'Insert compressor',
            projectRevision,
        });

        const failed = await confirmPendingChatActions({ confirmationId: 'confirmation-runtime-effect' });

        expect(failed).toMatchObject({
            status: 'failed',
            durableCommit: true,
            effects: [
                {
                    kind: 'runtime-graph',
                    state: 'pending',
                    operation: 'addDevice',
                    reason: 'runtime graph revision is stale',
                    remediation: 'retry',
                },
            ],
            continuation: {
                authority: 'authoritative-collaboration-host',
                idempotency: 'project-checkpoint',
                kind: 'manual-repair',
            },
        });
        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.id)).toEqual([
            'device-eq',
            'device-compressor',
        ]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();
        expect(getPendingActionConfirmation('confirmation-runtime-effect')).toMatchObject({
            status: 'failed',
            executedActions: [{ outcome: 'committed-with-warning' }],
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            content: expect.not.stringContaining('Executed after confirmation'),
        });
        expect(agentRunLifecycle.get('run-runtime-effect')).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                {
                    batchId: 'group-runtime-effect',
                    effects: [
                        expect.objectContaining({
                            commandId: envelope.commandId,
                            kind: 'runtime-graph',
                            state: 'pending',
                            operation: 'addDevice',
                            reason: 'runtime graph revision is stale',
                            remediation: 'retry',
                        }),
                    ],
                    recovery: 'manual-repair',
                    serializedBatch: commandBatch.serialized,
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'manual-repair' }),
                ]),
            },
        });

        await undo();
        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.id)).toEqual(['device-eq']);
        expect(undoStore.value).toMatchObject({ past: [], future: [expect.anything()] });
        await redo();
        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.id)).toEqual([
            'device-eq',
            'device-compressor',
        ]);
        expect(undoStore.value).toMatchObject({ past: [expect.anything()], future: [] });

        configureCommandBatchIdempotency({ canExecute: () => true });
        await expect(
            getVersionedCommandBatchIdempotentReplay({
                authority: commandBatch.authority,
                serialized: commandBatch.serialized,
            })
        ).resolves.toMatchObject({
            outcome: 'partially-committed',
            pendingEffects: [
                expect.objectContaining({
                    kind: 'runtime-graph',
                    operation: 'addDevice',
                    reason: 'runtime graph revision is stale',
                }),
            ],
        });

        await expect(recoverInterruptedAgentRuns()).resolves.toEqual({ recoveredRunIds: ['run-runtime-effect'] });
        expect(agentRunLifecycle.get('run-runtime-effect')).toMatchObject({
            manualResume: { required: false },
            pendingEffectContinuations: [
                {
                    batchId: 'group-runtime-effect',
                    recovery: 'manual-repair',
                    serializedBatch: commandBatch.serialized,
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'manual-repair' }),
                ]),
            },
        });

        await expect(
            recoverAgentRunPendingEffects({
                runId: 'run-runtime-effect',
                batchId: 'group-runtime-effect',
            })
        ).resolves.toEqual({
            status: 'failed',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });

        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.id)).toEqual([
            'device-eq',
            'device-compressor',
        ]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(3);
        expect(repairRuntimeFromCurrentProject).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('run-runtime-effect')).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                expect.objectContaining({
                    batchId: 'group-runtime-effect',
                    lastError: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
                }),
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'manual-repair' }),
                ]),
            },
        });
    });

    it('keeps a confirmed batch authorized when its owned storage commit moves the project revision', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const firstAction = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const secondAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const unownedMutationBaseline = captureUnownedProjectMutations();
        const commands = [firstAction, secondAction].map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: `Tempo changes to ${String(action.payload.bpm)} BPM.`,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-self-revision', groupLabel: 'Set tempo twice', source: 'prompt' },
                })
            )
        );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-self-revision',
            batchId: 'group-self-revision',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128 then 132',
            commands,
        });
        proposePendingActionConfirmation({
            id: 'confirmation-self-revision',
            prompt: 'set tempo to 128 then 132',
            assistantMessageId: 'assistant-1',
            actions: [firstAction, secondAction],
            actionLabels: ['Set tempo to 128 BPM', 'Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-self-revision',
            groupLabel: 'Set tempo twice',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-self-revision' })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).not.toBe(projectRevision);
        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(getPendingActionConfirmation('confirmation-self-revision')).toMatchObject({ status: 'executed' });
    });

    it('invalidates and halts a confirmed batch when another owner flushes its unscoped pending write mid-action', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const bufferedStorage = createAutomergeStorage<{ touched: number }>('owned', 'buffered');
        const bufferedStore = createStore<{ touched: number }>({ storage: bufferedStorage });
        const reactiveStore = createStore<{ selected: string }>();
        const stopReacting = reactiveStore.subscribe(() => {
            flushAutomergeStorageWrites();
        });
        const executedBpms: number[] = [];
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            executedBpms.push(action.payload.bpm);
            ownedStorage.set({ bpm: action.payload.bpm });
            if (action.payload.bpm === 128) {
                reactiveStore.set({ selected: 'first action' });
            }
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const firstAction = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const secondAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const scheduledAnimationFrames = new Map<number, FrameRequestCallback>();
        let nextAnimationFrameId = 1;
        const requestAnimationFrameSpy = vi
            .spyOn(globalThis, 'requestAnimationFrame')
            .mockImplementation((callback) => {
                const frameId = nextAnimationFrameId++;
                scheduledAnimationFrames.set(frameId, callback);
                return frameId;
            });
        const cancelAnimationFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((frameId) => {
            scheduledAnimationFrames.delete(frameId);
        });
        onTestFinished(() => {
            stopReacting();
            requestAnimationFrameSpy.mockRestore();
            cancelAnimationFrameSpy.mockRestore();
            scheduledAnimationFrames.clear();
        });

        bufferedStore.set({ touched: 1 });
        expect(scheduledAnimationFrames.size).toBe(1);
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('buffered');
        const projectRevision = captureProjectRevision();
        const unownedMutationBaseline = captureUnownedProjectMutations();
        const commands = [firstAction, secondAction].map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: `Tempo changes to ${String(action.payload.bpm)} BPM.`,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-foreign-flush', groupLabel: 'Set tempo twice', source: 'prompt' },
                })
            )
        );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-foreign-flush',
            batchId: 'group-foreign-flush',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128 then 132',
            commands,
        });
        proposePendingActionConfirmation({
            id: 'confirmation-foreign-flush',
            prompt: 'set tempo to 128 then 132',
            assistantMessageId: 'assistant-1',
            actions: [firstAction, secondAction],
            actionLabels: ['Set tempo to 128 BPM', 'Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-foreign-flush',
            groupLabel: 'Set tempo twice',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-foreign-flush' })).resolves.toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });

        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline + 1);
        expect(executedBpms).toContain(128);
        expect(executedBpms).not.toContain(132);
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ buffered: { touched: 1 } });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
        expect(getPendingActionConfirmation('confirmation-foreign-flush')).toMatchObject({ status: 'invalidated' });
        expect(scheduledAnimationFrames.size).toBe(0);
    });

    it('keeps callback evidence bound to the checkpoint before a later foreign app action', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => {
                    ownedStorage.set({ bpm: action.payload.bpm });
                },
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        registerHandlerMap(getAudioRenderingHandlers());
        const verseJob = {
            jobId: 'render-verse',
            sectionId: 'section-verse',
            sectionName: 'Verse',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        };
        const chorusJob = {
            ...verseJob,
            jobId: 'render-chorus',
            sectionId: 'section-chorus',
            sectionName: 'Chorus',
            startBeat: 16,
            endBeat: 48,
        };
        const tempoAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const renderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: [verseJob.sectionId, chorusJob.sectionId], jobs: [verseJob, chorusJob] },
        } satisfies RenderSectionsAction;
        let lastRenderAttempted = false;
        runtimeMocks.renderOffline.mockReset();
        runtimeMocks.renderOffline.mockImplementation((options: { startBeat?: number }) => {
            if (options.startBeat === chorusJob.startBeat) {
                lastRenderAttempted = true;
                return Promise.reject(new Error('comparison renderer unavailable'));
            }
            return Promise.resolve({
                sampleRate: verseJob.sampleRate,
                length: 88_200,
                numberOfChannels: 2,
                duration: 2,
            });
        });
        // The batch flight awaits durable idempotency completion after its
        // project checkpoint is visible. Land a foreign app action in that
        // await: its later revision must not relabel storage-commit evidence.
        let foreignWriteInjected = false;
        let foreignRevision: string | null = null;
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: async (_name: string, _options: LockOptions, task: () => unknown) => {
                    if (lastRenderAttempted && !foreignWriteInjected) {
                        foreignWriteInjected = true;
                        await executeAppAction({ type: 'setTempo', payload: { bpm: 144 } });
                        foreignRevision = captureProjectRevision();
                    }
                    return task();
                },
            },
        });
        const projectRevision = captureProjectRevision();
        const serializeCommand = (action: SetTempoAction | RenderSectionsAction, expectedEffect: string) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-render-rebind', groupLabel: 'Tempo and renders', source: 'prompt' },
                })
            );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-render-rebind',
            batchId: 'group-render-rebind',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 132 and render sections',
            commands: [
                serializeCommand(tempoAction, 'Tempo changes to 132 BPM.'),
                serializeCommand(renderAction, 'Render Verse and Chorus for comparison.'),
            ],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-render-rebind',
            request: 'set tempo to 132 and render sections',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-render-rebind', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-render-rebind', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-render-rebind',
            runId: 'confirmation-render-rebind',
            prompt: 'set tempo to 132 and render sections',
            assistantMessageId: 'assistant-1',
            actions: [tempoAction, renderAction],
            actionLabels: ['Set tempo to 132 BPM', 'Render Verse and Chorus'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-render-rebind',
            groupLabel: 'Tempo and renders',
            projectRevision,
        });
        let storageCommitRevision: string | null = null;
        const executeBatchImplementation = commandUseCases.executeVersionedCommandBatchEnvelope;
        const executeBatch = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockImplementation((input) => {
                const onProjectCommitFinalized = input.options?.onProjectCommitFinalized;
                return executeBatchImplementation({
                    ...input,
                    options: {
                        ...input.options,
                        onProjectCommitFinalized: (result) => {
                            storageCommitRevision = result.revision;
                            onProjectCommitFinalized?.(result);
                        },
                    },
                });
            });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-render-rebind' })
        ).resolves.toMatchObject({ status: 'failed', durableCommit: true });
        expect(executeBatch).toHaveBeenCalledOnce();

        expect(foreignWriteInjected).toBe(true);
        expect(foreignRevision).not.toBeNull();
        expect(storageCommitRevision).not.toBeNull();
        expect(storageCommitRevision).not.toBe(foreignRevision);
        const committedConfirmation = getPendingActionConfirmation('confirmation-render-rebind');
        if (storageCommitRevision === null) {
            throw new Error('Expected a captured storage-commit revision');
        }
        expect(committedConfirmation).toMatchObject({
            status: 'failed',
            followUpProjectRevision: storageCommitRevision,
            followUpStatus: 'retryable',
        });
        const artifacts = getAgentSectionRenderArtifacts();
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0]).toMatchObject({ jobId: verseJob.jobId, sourceRevision: storageCommitRevision });
        expect(artifacts[0]?.sourceRevision).not.toBe(foreignRevision);

        // The retry stays bound to the storage commit and must fail closed
        // rather than treat the later foreign revision as its source.
        const renderCallsBeforeRetry = runtimeMocks.renderOffline.mock.calls.length;
        executeBatch.mockClear();
        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-render-rebind' })
        ).resolves.toMatchObject({ status: 'failed' });
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(renderCallsBeforeRetry);
        expect(executeBatch).not.toHaveBeenCalled();
        executeBatch.mockRestore();
    });

    it('settles a committed render as manual recovery when artifact rebinding fails', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => {
                    ownedStorage.set({ bpm: action.payload.bpm });
                },
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        registerHandlerMap(getAudioRenderingHandlers());
        const renderJob = {
            jobId: 'render-rebind-failure',
            sectionId: 'section-rebind-failure',
            sectionName: 'Rebind Failure',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        };
        const renderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: [renderJob.sectionId], jobs: [renderJob] },
        } satisfies RenderSectionsAction;
        runtimeMocks.renderOffline.mockResolvedValue({
            sampleRate: renderJob.sampleRate,
            length: 88_200,
            numberOfChannels: 2,
            duration: 2,
        });
        const projectRevision = captureProjectRevision();
        const tempoAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const tempoEnvelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: tempoAction,
            expectedEffect: 'Tempo changes to 132 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-rebind-failure', groupLabel: 'Tempo and render section', source: 'prompt' },
        });
        const renderEnvelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: renderAction,
            expectedEffect: 'Render the section for comparison.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-rebind-failure', groupLabel: 'Tempo and render section', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-rebind-failure',
            batchId: 'group-rebind-failure',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo and render section',
            commands: [
                serializeVersionedCommandEnvelope(tempoEnvelope),
                serializeVersionedCommandEnvelope(renderEnvelope),
            ],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-rebind-failure',
            request: 'set tempo and render section',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-rebind-failure', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-rebind-failure', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-rebind-failure',
            runId: 'confirmation-rebind-failure',
            prompt: 'set tempo and render section',
            assistantMessageId: 'assistant-1',
            actions: [tempoAction, renderAction],
            actionLabels: ['Set tempo to 132 BPM', 'Render section'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-rebind-failure',
            groupLabel: 'Tempo and render section',
            projectRevision,
        });
        const rebind = vi
            .spyOn(audioRenderingUseCases, 'rebindAgentProjectSectionArtifactRevisions')
            .mockImplementation(() => {
                throw new Error('render artifact vanished');
            });

        try {
            const result = await confirmPendingChatActions({ confirmationId: 'confirmation-rebind-failure' });
            expect(result).toMatchObject({
                status: 'failed',
                durableCommit: true,
                reason: expect.stringContaining('render artifact vanished'),
                effects: [
                    expect.objectContaining({
                        commandId: renderEnvelope.commandId,
                        operation: 'renderProjectSections',
                        remediation: 'manual-repair',
                    }),
                ],
                continuation: { kind: 'manual-repair' },
            });
        } finally {
            rebind.mockRestore();
        }

        expect(getPendingActionConfirmation('confirmation-rebind-failure')).toMatchObject({
            status: 'failed',
            followUpProjectRevision: null,
            followUpStatus: 'failed',
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            pendingActionFollowUpStatus: 'failed',
            content: expect.not.stringContaining('Executed after confirmation'),
        });
        expect(
            selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
                ({ runId, batchId }) => runId === 'confirmation-rebind-failure' && batchId === 'group-rebind-failure'
            )
        ).toMatchObject({
            recovery: 'manual-repair',
            effects: [
                expect.objectContaining({
                    commandId: renderEnvelope.commandId,
                    operation: 'renderProjectSections',
                    remediation: 'manual-repair',
                }),
            ],
        });
        expect(
            selectAgentRunPendingEffectRecoveries(readAgentRunState())
                .find(
                    ({ runId, batchId }) =>
                        runId === 'confirmation-rebind-failure' && batchId === 'group-rebind-failure'
                )
                ?.effects.map(({ commandId }) => commandId)
        ).toEqual([renderEnvelope.commandId]);
    });

    it('preserves existing non-render pending effects when synthesizing render manual repair', async () => {
        const runId = 'confirmation-mixed-render-manual-repair';
        const confirmationId = 'confirmation-mixed-render-manual-repair';
        const batchId = 'group-mixed-render-manual-repair';
        configureAiWorkflowCommandPreflightFixture('project-mixed-render-manual-repair');
        configureCommandBatchIdempotency({ canExecute: () => true });
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAudioRenderingHandlers());
        const addDeviceAction = {
            type: 'addDevice',
            payload: {
                trackId: 'track-bass',
                deviceType: 'builtin-compressor',
                deviceId: 'device-compressor',
                afterDeviceId: 'device-eq',
                expectedDeviceIds: ['device-eq'],
                expectedFrozen: false,
            },
        } satisfies AddDeviceAction;
        const renderJob = {
            jobId: 'render-mixed-manual-repair',
            sectionId: 'section-mixed-manual-repair',
            sectionName: 'Mixed Manual Repair',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        };
        const renderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: [renderJob.sectionId], jobs: [renderJob] },
        } satisfies RenderSectionsAction;
        const secondRenderJob = {
            ...renderJob,
            jobId: 'render-mixed-manual-repair-chorus',
            sectionId: 'section-mixed-manual-repair-chorus',
            sectionName: 'Mixed Manual Repair Chorus',
            startBeat: 16,
            endBeat: 32,
        };
        const secondRenderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: [secondRenderJob.sectionId], jobs: [secondRenderJob] },
        } satisfies RenderSectionsAction;
        const projectRevision = captureProjectRevision();
        const addDeviceEnvelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: addDeviceAction,
            expectedEffect: 'Insert the compressor after EQ on Bass.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: batchId, groupLabel: 'Insert compressor and render', source: 'prompt' },
        });
        const renderEnvelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: renderAction,
            expectedEffect: 'Render the section for comparison.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: batchId, groupLabel: 'Insert compressor and render', source: 'prompt' },
        });
        const secondRenderEnvelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: secondRenderAction,
            expectedEffect: 'Render the chorus for comparison.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: batchId, groupLabel: 'Insert compressor and render', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId,
            batchId,
            projectId: 'project-mixed-render-manual-repair',
            baseRevision: projectRevision,
            intent: 'insert compressor and render section',
            commands: [
                serializeVersionedCommandEnvelope(addDeviceEnvelope),
                serializeVersionedCommandEnvelope(renderEnvelope),
                serializeVersionedCommandEnvelope(secondRenderEnvelope),
            ],
        });
        agentRunLifecycle.create({
            runId,
            request: 'Insert the compressor and render the section.',
            mode: 'apply',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId, phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: confirmationId,
            runId,
            prompt: 'Insert the compressor and render the section.',
            assistantMessageId: 'assistant-1',
            actions: [addDeviceAction, renderAction, secondRenderAction],
            actionLabels: ['Insert compressor after EQ on Bass', 'Render section', 'Render chorus'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: batchId,
            groupLabel: 'Insert compressor and render',
            projectRevision,
        });
        const commandUseCases = await import('#/modules/Command/useCases');
        const crdtUseCases = await import('#/modules/CrdtDocument/useCases');
        const captureMutationAuthorization = vi
            .spyOn(crdtUseCases, 'captureProjectMutationAuthorization')
            .mockReturnValue(() => true);
        const execute = vi
            .spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope')
            .mockImplementation(async (input) => {
                input.options?.onProjectCommitFinalizationUnavailable?.({
                    reason: 'The final project revision is unavailable.',
                });
                return createPendingRuntimeGraphBatchResult(commandBatch);
            });

        let result: Awaited<ReturnType<typeof confirmPendingChatActions>> | null = null;
        try {
            result = await confirmPendingChatActions({ confirmationId });
            expect(result).toMatchObject({
                status: 'failed',
                durableCommit: true,
                continuation: { kind: 'manual-repair' },
            });
        } finally {
            execute.mockRestore();
            captureMutationAuthorization.mockRestore();
        }
        if (result === null) {
            throw new Error('Expected confirmation to return a durable manual-repair failure.');
        }
        expect(result).toMatchObject({
            effects: [
                expect.objectContaining({
                    commandId: addDeviceEnvelope.commandId,
                    kind: 'runtime-graph',
                    operation: 'addDevice',
                    remediation: 'retry',
                }),
                expect.objectContaining({
                    commandId: renderEnvelope.commandId,
                    kind: 'external-effect',
                    operation: 'renderProjectSections',
                    remediation: 'manual-repair',
                }),
                expect.objectContaining({
                    commandId: secondRenderEnvelope.commandId,
                    kind: 'external-effect',
                    operation: 'renderProjectSections',
                    remediation: 'manual-repair',
                }),
            ],
        });

        const continuation = selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
            (candidate) => candidate.runId === runId && candidate.batchId === batchId
        );
        expect(continuation).toMatchObject({
            batchId,
            recovery: 'manual-repair',
            runId,
        });
        expect(continuation?.effects).toEqual([
            expect.objectContaining({
                commandId: addDeviceEnvelope.commandId,
                kind: 'runtime-graph',
                operation: 'addDevice',
                remediation: 'retry',
            }),
            expect.objectContaining({
                commandId: renderEnvelope.commandId,
                kind: 'external-effect',
                operation: 'renderProjectSections',
                remediation: 'manual-repair',
                reason: 'The final project revision is unavailable.',
            }),
            expect.objectContaining({
                commandId: secondRenderEnvelope.commandId,
                kind: 'external-effect',
                operation: 'renderProjectSections',
                remediation: 'manual-repair',
                reason: 'The final project revision is unavailable.',
            }),
        ]);
        expect(agentRunLifecycle.get(runId)?.pendingEffectContinuations).toEqual([
            expect.objectContaining({
                authority: commandBatch.authority,
                receiptIdentity: `2:${runId}:${batchId}:partially-committed`,
                recovery: 'manual-repair',
                serializedBatch: commandBatch.serialized,
            }),
        ]);

        const persistedState = window.localStorage.getItem('sourdaw-agent-runs');
        if (!persistedState) {
            throw new Error('Expected mixed pending-effect recovery to be persisted.');
        }
        agentRunLifecycle.clear();
        const reloadedState = sanitizeAgentRunState(parsePersistedValue(persistedState));
        if (!agentRunStore.trySet(reloadedState)) {
            throw new Error('Expected mixed pending-effect recovery to reload.');
        }
        const verifiedBatchResult = createPendingRuntimeGraphBatchResult(commandBatch);
        if (!('receipt' in verifiedBatchResult)) {
            throw new Error('Expected the mixed recovery fixture to carry its verified receipt.');
        }
        const verifiedReceipt = verifiedBatchResult.receipt;
        const readReceipt = vi
            .spyOn(commandUseCases, 'getVersionedCommandBatchIdempotentReplay')
            .mockResolvedValue(verifiedReceipt);
        const replayBatch = vi.spyOn(commandUseCases, 'executeVersionedCommandBatchEnvelope');
        await expect(recoverAgentRunPendingEffects({ runId, batchId })).resolves.toEqual({
            status: 'failed',
            reason: 'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.',
        });
        expect(readReceipt).toHaveBeenCalledWith({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        expect(replayBatch).not.toHaveBeenCalled();
        readReceipt.mockRestore();
        replayBatch.mockRestore();
        expect(agentRunLifecycle.get(runId)).toMatchObject({
            phase: 'partially-completed',
            pendingEffectContinuations: [
                expect.objectContaining({
                    batchId,
                    recovery: 'manual-repair',
                    effects: [
                        expect.objectContaining({ commandId: addDeviceEnvelope.commandId }),
                        expect.objectContaining({ commandId: renderEnvelope.commandId, remediation: 'manual-repair' }),
                        expect.objectContaining({
                            commandId: secondRenderEnvelope.commandId,
                            remediation: 'manual-repair',
                        }),
                    ],
                }),
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'manual-repair' }),
                ]),
            },
        });
    });

    it('requires manual recovery when an ownerless mutation lands during a two-job render', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: (action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }),
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: { type: 'setTempo', payload: { bpm: 120, expectedBpm: action.payload.bpm } },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        registerHandlerMap(getAudioRenderingHandlers());
        const verseJob = {
            jobId: 'render-ownerless-verse',
            sectionId: 'section-ownerless-verse',
            sectionName: 'Ownerless Verse',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        };
        const chorusJob = {
            ...verseJob,
            jobId: 'render-ownerless-chorus',
            sectionId: 'section-ownerless-chorus',
            sectionName: 'Ownerless Chorus',
            startBeat: 16,
            endBeat: 48,
        };
        const tempoAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const renderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: [verseJob.sectionId, chorusJob.sectionId], jobs: [verseJob, chorusJob] },
        } satisfies RenderSectionsAction;
        createCrdtDoc('ownerless-render-writer');
        let ownerlessMutationInjected = false;
        runtimeMocks.renderOffline.mockReset();
        runtimeMocks.renderOffline.mockImplementation((options: { startBeat?: number }) => {
            if (options.startBeat === verseJob.startBeat) {
                ownerlessMutationInjected = true;
                mutateCrdtDoc<Record<string, unknown>>({
                    id: 'ownerless-render-writer',
                    changeFn: (doc) => {
                        doc.changedDuringRender = true;
                    },
                });
                return Promise.resolve({
                    sampleRate: verseJob.sampleRate,
                    length: 88_200,
                    numberOfChannels: 2,
                    duration: 2,
                });
            }
            return Promise.reject(new Error('comparison renderer unavailable'));
        });
        const projectRevision = captureProjectRevision();
        const serializeCommand = (action: SetTempoAction | RenderSectionsAction, expectedEffect: string) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect,
                    normalizedProjectRevision: projectRevision,
                    options: {
                        groupId: 'group-ownerless-render',
                        groupLabel: 'Tempo and ownerless renders',
                        source: 'prompt',
                    },
                })
            );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-ownerless-render',
            batchId: 'group-ownerless-render',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo and render two sections',
            commands: [
                serializeCommand(tempoAction, 'Tempo changes to 132 BPM.'),
                serializeCommand(renderAction, 'Render Ownerless Verse and Ownerless Chorus.'),
            ],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-ownerless-render',
            request: 'set tempo and render two sections',
            mode: 'macro',
            createdRevision: projectRevision,
            budgets: { limits: { maxCommands: 2, maxRenderJobs: 2 }, consumed: {} },
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-ownerless-render', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-ownerless-render', phase: 'waiting-for-approval' });
        const release = vi.fn().mockResolvedValue(undefined);
        const retain = vi.fn().mockResolvedValue(undefined);
        proposePendingActionConfirmation({
            id: 'confirmation-ownerless-render',
            runId: 'confirmation-ownerless-render',
            prompt: 'set tempo and render two sections',
            assistantMessageId: 'assistant-1',
            actions: [tempoAction, renderAction],
            actionLabels: ['Set tempo to 132 BPM', 'Render Ownerless Verse and Ownerless Chorus'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-ownerless-render',
            groupLabel: 'Tempo and ownerless renders',
            projectRevision,
            resourceLease: { bytes: 1, release, retain },
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-ownerless-render' })
        ).resolves.toMatchObject({
            status: 'failed',
            durableCommit: true,
            continuation: { kind: 'manual-repair' },
        });

        expect(ownerlessMutationInjected).toBe(true);
        expect(getPendingActionConfirmation('confirmation-ownerless-render')).toMatchObject({
            status: 'failed',
            followUpProjectRevision: null,
            followUpStatus: 'failed',
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'failed',
            pendingActionFollowUpStatus: 'failed',
            content: expect.stringContaining(
                'Do not replay these actions; use the retained pending-effect recovery guidance.'
            ),
        });
        expect(
            selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
                ({ runId, batchId }) =>
                    runId === 'confirmation-ownerless-render' && batchId === 'group-ownerless-render'
            )
        ).toMatchObject({ recovery: 'manual-repair' });
        expect(agentRunLifecycle.get('confirmation-ownerless-render')).toMatchObject({
            budgets: { consumed: { maxCommands: 2, maxRenderJobs: 1 } },
            workLeases: [expect.objectContaining({ workId: 'group-ownerless-render', terminalState: 'completed' })],
        });
        expect(retain).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'retains a warned render artifact without replaying project commands (manual persistence fails: %s)',
        async (manualPersistenceFails) => {
            configureAiWorkflowCommandPreflightFixture('project-1');
            configureCommandBatchIdempotency({ canExecute: () => true });
            const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
            const executeTempo = vi.fn((action: SetTempoAction) => {
                ownedStorage.set({ bpm: action.payload.bpm });
            });
            registerHandlerMap({
                setTempo: {
                    canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                    execute: executeTempo,
                    describe: (action) => ({
                        label: 'Set tempo',
                        inverseAction: {
                            type: 'setTempo',
                            payload: { bpm: 120, expectedBpm: action.payload.bpm },
                        },
                    }),
                    undoable: true,
                    validate: () => true,
                },
            });
            registerHandlerMap(getAudioRenderingHandlers());
            const renderJob = {
                jobId: 'render-warned-verse',
                sectionId: 'section-warned-verse',
                sectionName: 'Warned Verse',
                startBeat: 0,
                endBeat: 16,
                sampleRate: 44_100,
                tailSeconds: 0,
            };
            const tempoAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
            const renderAction = {
                type: 'renderProjectSections',
                payload: { sectionIds: [renderJob.sectionId], jobs: [renderJob] },
            } satisfies RenderSectionsAction;
            runtimeMocks.renderOffline.mockReset();
            runtimeMocks.renderOffline.mockImplementation(
                (options: { onWarning?: (warning: string) => void; sampleRate?: number }) => {
                    options.onWarning?.('tail truncated');
                    options.onWarning?.('peak clipped');
                    return Promise.resolve({
                        sampleRate: options.sampleRate ?? renderJob.sampleRate,
                        length: 88_200,
                        numberOfChannels: 2,
                        duration: 2,
                    });
                }
            );
            const projectRevision = captureProjectRevision();
            const serializeCommand = (action: SetTempoAction | RenderSectionsAction, expectedEffect: string) =>
                serializeVersionedCommandEnvelope(
                    migrateLegacyAppActionToVersionedCommandEnvelope({
                        action,
                        expectedEffect,
                        normalizedProjectRevision: projectRevision,
                        options: {
                            groupId: 'group-warned-render',
                            groupLabel: 'Tempo and warned render',
                            source: 'prompt',
                        },
                    })
                );
            const commandBatch = compileVersionedCommandBatchEnvelope({
                runId: 'confirmation-warned-render',
                batchId: 'group-warned-render',
                projectId: 'project-1',
                baseRevision: projectRevision,
                intent: 'set tempo and render a comparison',
                commands: [
                    serializeCommand(tempoAction, 'Tempo changes to 132 BPM.'),
                    serializeCommand(renderAction, 'Render the warned verse for comparison.'),
                ],
            });
            agentRunLifecycle.create({
                runId: 'confirmation-warned-render',
                request: 'set tempo and render a comparison',
                mode: 'macro',
                createdRevision: projectRevision,
            });
            agentRunLifecycle.transitionPhase({ runId: 'confirmation-warned-render', phase: 'planning' });
            agentRunLifecycle.transitionPhase({ runId: 'confirmation-warned-render', phase: 'waiting-for-approval' });
            const manualRepairSpy = manualPersistenceFails
                ? vi.spyOn(agentRunLifecycle, 'requirePendingEffectManualRepair').mockImplementation(() => {
                      throw new Error('manual repair persistence unavailable');
                  })
                : null;
            proposePendingActionConfirmation({
                id: 'confirmation-warned-render',
                runId: 'confirmation-warned-render',
                prompt: 'set tempo and render a comparison',
                assistantMessageId: 'assistant-1',
                actions: [tempoAction, renderAction],
                actionLabels: ['Set tempo to 132 BPM', 'Render Warned Verse'],
                commandBatch,
                agentApproval: compileAgentRiskApproval({ commandBatch }),
                executionMode: 'atomic',
                groupId: 'group-warned-render',
                groupLabel: 'Tempo and warned render',
                projectRevision,
            });

            await expect(
                confirmPendingChatActions({ confirmationId: 'confirmation-warned-render' })
            ).resolves.toMatchObject({ status: 'failed', durableCommit: true });

            expect(runtimeMocks.renderOffline).toHaveBeenCalledOnce();
            expect(executeTempo).toHaveBeenCalledOnce();
            if (manualPersistenceFails) {
                expect(getPendingActionConfirmation('confirmation-warned-render')).toMatchObject({
                    status: 'failed',
                    followUpStatus: 'failed',
                    error: expect.stringContaining('manual-repair state could not be persisted'),
                });
                expect(chatStore.value?.messages.find((message) => message.id === 'assistant-1')).toMatchObject({
                    pendingActionConfirmationStatus: 'failed',
                    pendingActionFollowUpStatus: 'failed',
                    content: expect.stringContaining('Do not reconcile or replay this committed batch'),
                });
                await expect(
                    recoverAgentRunPendingEffects({
                        runId: 'confirmation-warned-render',
                        batchId: 'group-warned-render',
                    })
                ).resolves.toMatchObject({ status: 'failed' });
                expect(runtimeMocks.renderOffline).toHaveBeenCalledOnce();
                expect(executeTempo).toHaveBeenCalledOnce();
                manualRepairSpy?.mockRestore();
                return;
            }
            const verifiedReceipt = await getVersionedCommandBatchIdempotentReplay({
                authority: commandBatch.authority,
                serialized: commandBatch.serialized,
            });
            expect(verifiedReceipt?.pendingEffects).toEqual([
                expect.objectContaining({
                    kind: 'external-effect',
                    remediation: 'manual-repair',
                    reason: expect.stringContaining('tail truncated; peak clipped'),
                }),
            ]);
            expect(getAgentSectionRenderArtifacts()).toContainEqual(
                expect.objectContaining({ jobId: renderJob.jobId, warnings: ['tail truncated', 'peak clipped'] })
            );
            expect(getPendingActionConfirmation('confirmation-warned-render')).toMatchObject({
                status: 'executed',
                followUpStatus: 'failed',
                error: 'Section render artifacts require manual review: render-warned-verse (tail truncated; peak clipped).',
            });
            expect(chatStore.value?.messages.find((message) => message.id === 'assistant-1')).toMatchObject({
                pendingActionConfirmationStatus: 'executed',
                pendingActionFollowUpStatus: 'failed',
                error: 'Section render artifacts require manual review: render-warned-verse (tail truncated; peak clipped).',
                content: expect.stringContaining(
                    'The project commands were not replayed. Section render artifacts require manual review: render-warned-verse (tail truncated; peak clipped).'
                ),
            });
            expect(
                agentRunLifecycle
                    .get('confirmation-warned-render')
                    ?.pendingEffectContinuations.filter(({ batchId }) => batchId === 'group-warned-render')
            ).toEqual([
                expect.objectContaining({
                    batchId: 'group-warned-render',
                    recovery: 'manual-repair',
                    lastError:
                        'Section render artifacts require manual review: render-warned-verse (tail truncated; peak clipped).',
                }),
            ]);
            expect(
                (readAgentRunState().pendingEffectRecoveryLedger ?? []).filter(
                    ({ runId, batchId }) => runId === 'confirmation-warned-render' && batchId === 'group-warned-render'
                )
            ).toEqual([
                expect.objectContaining({
                    checkpoint: 'durable',
                    recovery: 'manual-repair',
                    lastError:
                        'Section render artifacts require manual review: render-warned-verse (tail truncated; peak clipped).',
                }),
            ]);
            expect(
                selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
                    ({ runId, batchId }) => runId === 'confirmation-warned-render' && batchId === 'group-warned-render'
                )
            ).toMatchObject({ recovery: 'manual-repair' });
            await expect(confirmPendingChatActions({ confirmationId: 'confirmation-warned-render' })).resolves.toEqual({
                status: 'not_pending',
                currentStatus: 'executed',
            });
            expect(runtimeMocks.renderOffline).toHaveBeenCalledOnce();
            expect(executeTempo).toHaveBeenCalledOnce();
            const manualContinuation = agentRunLifecycle
                .get('confirmation-warned-render')
                ?.pendingEffectContinuations.find(({ batchId }) => batchId === 'group-warned-render');
            if (!manualContinuation) {
                throw new Error('Expected retained render continuation');
            }
            agentRunLifecycle.recordPendingEffectContinuation({
                runId: 'confirmation-warned-render',
                continuation: {
                    ...manualContinuation,
                    effects: manualContinuation.effects.map((effect) =>
                        effect.kind === 'external-effect' ? { ...effect, remediation: 'reconcile' } : effect
                    ),
                    recovery: 'reconcile-batch',
                },
            });
            clearAgentSectionRenderArtifacts();
            mutateCrdtDoc<Record<string, unknown>>({
                id: 'independent',
                changeFn: (doc) => {
                    doc.changedAfterManualReview = true;
                },
            });
            await expect(
                recoverAgentRunPendingEffects({
                    runId: 'confirmation-warned-render',
                    batchId: 'group-warned-render',
                })
            ).resolves.toEqual({
                status: 'failed',
                reason: 'The durable project checkpoint does not match the retained pending-effect proof.',
            });
            expect(runtimeMocks.renderOffline).toHaveBeenCalledOnce();
            expect(
                agentRunLifecycle
                    .get('confirmation-warned-render')
                    ?.pendingEffectContinuations.some(({ batchId }) => batchId === 'group-warned-render')
            ).toBe(true);
            manualRepairSpy?.mockRestore();
        }
    );

    it('keeps an incomplete retention-capacity render in manual recovery without arming replay', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        runtimeMocks.renderOffline.mockReset();
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const executeTempo = vi.fn((action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }));
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: executeTempo,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: { type: 'setTempo', payload: { bpm: 120, expectedBpm: action.payload.bpm } },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        registerHandlerMap(getAudioRenderingHandlers());
        const jobs = Array.from({ length: 17 }, (_, index) => ({
            jobId: `render-capacity-${String(index)}`,
            sectionId: `section-capacity-${String(index)}`,
            sectionName: `Capacity ${String(index)}`,
            startBeat: index * 16,
            endBeat: index * 16 + 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        }));
        const tempoAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const renderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: jobs.map((job) => job.sectionId), jobs },
        } satisfies RenderSectionsAction;
        const projectRevision = captureProjectRevision();
        const serializeCommand = (action: SetTempoAction | RenderSectionsAction, expectedEffect: string) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect,
                    normalizedProjectRevision: projectRevision,
                    options: {
                        groupId: 'group-capacity-render',
                        groupLabel: 'Tempo and capacity render',
                        source: 'prompt',
                    },
                })
            );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-capacity-render',
            batchId: 'group-capacity-render',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo and render too many sections',
            commands: [
                serializeCommand(tempoAction, 'Tempo changes to 132 BPM.'),
                serializeCommand(renderAction, 'Render every requested section.'),
            ],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-capacity-render',
            request: 'set tempo and render too many sections',
            mode: 'macro',
            createdRevision: projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-capacity-render', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-capacity-render', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-capacity-render',
            runId: 'confirmation-capacity-render',
            prompt: 'set tempo and render too many sections',
            assistantMessageId: 'assistant-1',
            actions: [tempoAction, renderAction],
            actionLabels: ['Set tempo to 132 BPM', 'Render sections'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-capacity-render',
            groupLabel: 'Tempo and capacity render',
            projectRevision,
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-capacity-render' })
        ).resolves.toMatchObject({ status: 'failed', durableCommit: true });

        expect(executeTempo).toHaveBeenCalledOnce();
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
        const retainedConfirmation = getPendingActionConfirmation('confirmation-capacity-render');
        expect(retainedConfirmation).toMatchObject({
            status: 'executed',
            followUpProjectRevision: null,
            followUpStatus: 'failed',
            error: expect.stringContaining('artifact capacity exceeded'),
        });
        expect(chatStore.value?.messages.find((message) => message.id === 'assistant-1')).toMatchObject({
            pendingActionFollowUpStatus: 'failed',
            content: expect.stringContaining('The project commands were not replayed'),
        });
        expect(
            selectAgentRunPendingEffectRecoveries(readAgentRunState()).find(
                ({ runId, batchId }) => runId === 'confirmation-capacity-render' && batchId === 'group-capacity-render'
            )
        ).toMatchObject({ recovery: 'manual-repair' });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-capacity-render' })).resolves.toEqual({
            status: 'failed',
            reason: retainedConfirmation?.error,
        });
        expect(executeTempo).toHaveBeenCalledOnce();
        expect(runtimeMocks.renderOffline).not.toHaveBeenCalled();
    });

    it('charges every failed render start and blocks a retained retry from exceeding its budget', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const executeTempo = vi.fn((action: SetTempoAction) => ownedStorage.set({ bpm: action.payload.bpm }));
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
                execute: executeTempo,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: { type: 'setTempo', payload: { bpm: 120, expectedBpm: action.payload.bpm } },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        registerHandlerMap(getAudioRenderingHandlers());
        const jobs = ['verse', 'chorus'].map((name, index) => ({
            jobId: `render-failed-${name}`,
            sectionId: `section-failed-${name}`,
            sectionName: name,
            startBeat: index * 16,
            endBeat: index * 16 + 16,
            sampleRate: 44_100,
            tailSeconds: 0,
        }));
        const tempoAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const renderAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: jobs.map((job) => job.sectionId), jobs },
        } satisfies RenderSectionsAction;
        runtimeMocks.renderOffline.mockReset();
        runtimeMocks.renderOffline.mockRejectedValue(new Error('offline renderer unavailable'));
        const projectRevision = captureProjectRevision();
        const serializeCommand = (action: SetTempoAction | RenderSectionsAction, expectedEffect: string) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect,
                    normalizedProjectRevision: projectRevision,
                    options: {
                        groupId: 'group-failed-renders',
                        groupLabel: 'Tempo and failed renders',
                        source: 'prompt',
                    },
                })
            );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-failed-renders',
            batchId: 'group-failed-renders',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo and render two sections',
            commands: [
                serializeCommand(tempoAction, 'Tempo changes to 132 BPM.'),
                serializeCommand(renderAction, 'Render Verse and Chorus.'),
            ],
        });
        agentRunLifecycle.create({
            runId: 'confirmation-failed-renders',
            request: 'set tempo and render two sections',
            mode: 'macro',
            createdRevision: projectRevision,
            budgets: { limits: { maxCommands: 2, maxRenderJobs: 2 }, consumed: {} },
        });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-failed-renders', phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: 'confirmation-failed-renders', phase: 'waiting-for-approval' });
        proposePendingActionConfirmation({
            id: 'confirmation-failed-renders',
            runId: 'confirmation-failed-renders',
            prompt: 'set tempo and render two sections',
            assistantMessageId: 'assistant-1',
            actions: [tempoAction, renderAction],
            actionLabels: ['Set tempo to 132 BPM', 'Render Verse and Chorus'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-failed-renders',
            groupLabel: 'Tempo and failed renders',
            projectRevision,
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-failed-renders' })
        ).resolves.toMatchObject({ status: 'failed', durableCommit: true });

        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(2);
        expect(agentRunLifecycle.get('confirmation-failed-renders')?.budgets.consumed).toMatchObject({
            maxCommands: 2,
            maxRenderJobs: 2,
        });
        expect(getPendingActionConfirmation('confirmation-failed-renders')).toMatchObject({
            status: 'failed',
            followUpStatus: 'retryable',
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-failed-renders' })
        ).resolves.toMatchObject({ status: 'failed', reason: expect.stringContaining('maxRenderJobs') });
        expect(runtimeMocks.renderOffline).toHaveBeenCalledTimes(2);
        expect(executeTempo).toHaveBeenCalledOnce();
    });

    it('invalidates a confirmed batch when another app action commits while its first handler is paused', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        let releaseFirstAction!: () => void;
        let markFirstActionStarted!: () => void;
        const firstActionStarted = new Promise<void>((resolve) => {
            markFirstActionStarted = resolve;
        });
        const firstActionRelease = new Promise<void>((resolve) => {
            releaseFirstAction = resolve;
        });
        const executedBpms: number[] = [];
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>(async (action) => {
            executedBpms.push(action.payload.bpm);
            if (action.payload.bpm === 144) {
                mutateCrdtDoc({
                    id: 'independent',
                    changeFn: (doc) => {
                        doc.foreignActionCommitted = true;
                    },
                });
                return;
            }
            ownedStorage.set({ bpm: action.payload.bpm });
            if (action.payload.bpm === 128) {
                markFirstActionStarted();
                await firstActionRelease;
            }
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const firstAction = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const secondAction = { type: 'setTempo', payload: { bpm: 132 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const commands = [firstAction, secondAction].map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: `Tempo changes to ${String(action.payload.bpm)} BPM.`,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: 'group-foreign-action', groupLabel: 'Set tempo twice', source: 'prompt' },
                })
            )
        );
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-foreign-action',
            batchId: 'group-foreign-action',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128 then 132',
            commands,
        });
        proposePendingActionConfirmation({
            id: 'confirmation-foreign-action',
            prompt: 'set tempo to 128 then 132',
            assistantMessageId: 'assistant-1',
            actions: [firstAction, secondAction],
            actionLabels: ['Set tempo to 128 BPM', 'Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-foreign-action',
            groupLabel: 'Set tempo twice',
            projectRevision,
        });

        const confirmation = confirmPendingChatActions({ confirmationId: 'confirmation-foreign-action' });
        await firstActionStarted;
        await executeAppAction({ type: 'setTempo', payload: { bpm: 144 } });
        releaseFirstAction();

        await expect(confirmation).resolves.toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(executedBpms).not.toContain(132);
        expect(executedBpms).toContain(144);
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ foreignActionCommitted: true });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
        expect(getPendingActionConfirmation('confirmation-foreign-action')).toMatchObject({ status: 'invalidated' });
    });

    it('authorizes a confirmed action that creates a project document while it executes', async () => {
        // The shape the createDrumPreviewBranches carve-out used to cover:
        // the action's own execution adds documents, so the document identity
        // epoch moves under the batch. Attribution replaces the carve-out —
        // the inserts happen inside the action's write scope, so they are the
        // batch's own effect whatever the action type is.
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            createCrdtDoc('candidate-1');
            createCrdtDoc('candidate-2');
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const unownedMutationBaseline = captureUnownedProjectMutations();
        expect(getCrdtDocIds()).not.toContain('candidate-1');
        expect(getCrdtDocIds()).not.toContain('candidate-2');
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-doc-creating', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-doc-creating',
            batchId: 'group-doc-creating',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        proposePendingActionConfirmation({
            id: 'confirmation-doc-creating',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 128 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-doc-creating',
            groupLabel: 'Set tempo',
            projectRevision,
        });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-doc-creating' })).resolves.toEqual({
            status: 'executed',
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(captureUnownedProjectMutations()).toBe(unownedMutationBaseline);
        expect(captureProjectRevision()).not.toBe(projectRevision);
        expect(getCrdtDocIds()).toEqual(expect.arrayContaining(['candidate-1', 'candidate-2']));
        expect(getCrdtDoc<Record<string, unknown>>('candidate-1')).toBeDefined();
        expect(getCrdtDoc<Record<string, unknown>>('candidate-2')).toBeDefined();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 128 } });
    });

    // An outside writer moved the revision without touching anything this batch targets. Discarding
    // the plan there would cost the user their work for an edit that cannot conflict with it, so the
    // route revalidates and rebinds the same commands and asks for approval against the new revision.
    it('requires reapproval when an outside writer changed the project before confirmation', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
        const ownedStorage = createAutomergeStorage<{ bpm: number }>('owned', 'transport');
        const execute = vi.fn<ActionHandler<SetTempoAction>['execute']>((action) => {
            ownedStorage.set({ bpm: action.payload.bpm });
        });
        registerHandlerMap({
            setTempo: {
                canReapplyAfterDivergence: () => true,
                execute,
                describe: (action) => ({
                    label: 'Set tempo',
                    inverseAction: {
                        type: 'setTempo',
                        payload: { bpm: 120, expectedBpm: action.payload.bpm },
                    },
                }),
                undoable: true,
                validate: () => true,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const projectRevision = captureProjectRevision();
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            expectedEffect: 'Tempo changes to 128 BPM.',
            normalizedProjectRevision: projectRevision,
            options: { groupId: 'group-outside-writer', groupLabel: 'Set tempo', source: 'prompt' },
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            runId: 'confirmation-outside-writer',
            batchId: 'group-outside-writer',
            projectId: 'project-1',
            baseRevision: projectRevision,
            intent: 'set tempo to 128',
            commands: [serializeVersionedCommandEnvelope(envelope)],
        });
        proposePendingActionConfirmation({
            id: 'confirmation-outside-writer',
            prompt: 'set tempo to 128',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 128 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic',
            groupId: 'group-outside-writer',
            groupLabel: 'Set tempo',
            projectRevision,
        });

        // Somebody other than this proposal moves the project between the
        // proposal and the confirmation.
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.changedByAnotherWriter = true;
            },
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-outside-writer' })
        ).resolves.toMatchObject({
            status: 'reapproval_required',
            divergence: { kind: 'non-overlapping', mayReapply: true, targetIds: [] },
        });
        expect(execute).not.toHaveBeenCalled();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).not.toHaveProperty('transport');
        expect(getPendingActionConfirmation('confirmation-outside-writer')).toMatchObject({
            projectRevision: captureProjectRevision(),
            status: 'proposed',
        });
        expect(chatStore.value?.messages[0]).toMatchObject({
            pendingActionConfirmationStatus: 'proposed',
            content: expect.stringContaining('The project changed after the prior approval.'),
        });
    });
});
