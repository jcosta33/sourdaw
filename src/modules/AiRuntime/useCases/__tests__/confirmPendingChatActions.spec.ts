import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    commandBatchPreviewPort,
    commandRuntimeRepairPort,
    configureCommandBatchIdempotency,
    commandProjectDivergencePort,
    getVersionedCommandBatchIdempotentReplay,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    resetActionReplayAuthority,
    redo,
    serializeVersionedCommandEnvelope,
    undo,
    commandProjectRevisionPort,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCommandRecoveryWorkspace,
    createCommandPreviewWorkspace,
    createCrdtDoc,
    mutateCrdtDoc,
    removeCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { recoverAgentRunRuntimeEffects } from '../recoverAgentRunRuntimeEffects';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;
type AddDeviceAction = Extract<AppAction, { type: 'addDevice' }>;

const runtimeMocks = vi.hoisted(() => ({
    applyRuntimeGraphDelta: vi.fn(),
    getRuntimeGraphRevision: vi.fn(() => 4),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    applyRuntimeGraphDelta: runtimeMocks.applyRuntimeGraphDelta,
    getRuntimeGraphRevision: runtimeMocks.getRuntimeGraphRevision,
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

describe('confirmPendingChatActions transaction admission', () => {
    beforeEach(() => {
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
            projectId: projectRevision,
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

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-batch' })).resolves.toEqual({
            status: 'executed',
        });
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
        expect(observedSignal).toBeInstanceOf(AbortSignal);
        expect(observedSignal?.aborted).toBe(false);
        expect(agentRunLifecycle.get('confirmation-batch')).toMatchObject({
            phase: 'completed',
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

    it('routes a partially committed confirmation retry through external-effect recovery', async () => {
        configureAiWorkflowCommandPreflightFixture('project-1');
        configureCommandBatchIdempotency({ canExecute: () => true });
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
            prompt: 'set tempo to 132',
            assistantMessageId: 'assistant-1',
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            agentApproval: compileAgentRiskApproval({ commandBatch }),
            executionMode: 'atomic' as const,
            groupId: 'group-recovery-batch',
            groupLabel: 'Set tempo batch',
            projectRevision,
        };
        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-recovery-batch' });

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch' })).resolves.toEqual({
            status: 'executed',
        });
        expect(effectAttempts).toBe(2);

        proposePendingActionConfirmation({ ...proposal, id: 'confirmation-recovery-batch-retry' });
        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-recovery-batch-retry' })
        ).resolves.toEqual({ status: 'executed' });

        expect(effectAttempts).toBe(3);
        expect(chatStore.value?.messages[0]?.content).toContain('recovered verified receipt');
        expect(chatStore.value?.messages[0]?.content).toContain(
            'Pending external effects were reconciled successfully'
        );
        expect(chatStore.value?.messages[0]?.content).not.toContain('without replaying project or runtime effects');
        expect(chatStore.value?.messages[0]?.content).not.toContain('tempo runtime unavailable');
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
        expect(execute).toHaveBeenCalledOnce();
        expect(getCrdtDoc<Record<string, unknown>>('owned')).toMatchObject({ transport: { bpm: 132 } });
    });

    it('surfaces a durable add-device runtime failure and reconciles without replaying project truth', async () => {
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
                kind: 'reconcile-exact-batch',
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
            runtimeEffectContinuations: [
                {
                    batchId: 'group-runtime-effect',
                    commandIds: [envelope.commandId],
                    mode: 'retry-exact-effect',
                    serializedBatch: commandBatch.serialized,
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'external-pending' }),
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

        expect(recoverInterruptedAgentRuns()).toEqual({ recoveredRunIds: ['run-runtime-effect'] });
        expect(agentRunLifecycle.get('run-runtime-effect')).toMatchObject({
            manualResume: { required: false },
            runtimeEffectContinuations: [
                {
                    batchId: 'group-runtime-effect',
                    mode: 'retry-exact-effect',
                    serializedBatch: commandBatch.serialized,
                },
            ],
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'external-pending' }),
                ]),
            },
        });

        await expect(
            recoverAgentRunRuntimeEffects({
                runId: 'run-runtime-effect',
                batchId: 'group-runtime-effect',
            })
        ).resolves.toEqual({ status: 'recovered' });

        expect(trackStore.value?.tracks[0]?.devices.map((device) => device.id)).toEqual([
            'device-eq',
            'device-compressor',
        ]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(3);
        expect(repairRuntimeFromCurrentProject).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get('run-runtime-effect')).toMatchObject({
            phase: 'completed',
            saga: {
                steps: expect.arrayContaining([
                    expect.objectContaining({ owner: 'external-effect', state: 'committed' }),
                ]),
            },
        });
    });
});
