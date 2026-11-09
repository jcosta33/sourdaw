import { load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    getVersionedCommandBatchCommitProof,
    getVersionedCommandBatchIdempotentReplay,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { executePlannedActions } from '../executePlannedActions';
import { getProjectContext } from '../getProjectContext';
import { issueAgentCommandApprovalBinding } from '../issueAgentCommandApprovalBinding';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { configuredLiteralMetricState } from './metricGoalWorkflowFixture';
import { seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const CONFIRMATION_ID = 'save-finalization';
const DEFAULT_TRACK_COLOR = '#ffffff';
const APPROVED_COLOR = '#ff5500';
const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type ProjectRoot = {
    tracks?: { tracks: { id: string; color: string }[] };
    commandBatchIdempotency?: {
        records: {
            projectId: string;
            idempotencyKey: string;
            contentHash: string;
            state: string;
            serializedReceipt: string;
        }[];
    };
};

function createTrack(id: string, name: string): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: DEFAULT_TRACK_COLOR,
        clips: [],
        devices: [],
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

function planVocalsColor() {
    const context = getProjectContext();
    const projectRevision = captureProjectRevision();
    const materialized = materializeActionStateGuards(
        [{ type: 'setTrackColor', payload: { trackId: 'track-vocals', color: APPROVED_COLOR } }],
        context
    );
    if (materialized.status !== 'accepted') {
        throw new Error(materialized.reason);
    }
    const actions: ExecutableRuntimeAction[] = materialized.actions;
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: CONFIRMATION_ID,
        batchId: CONFIRMATION_ID,
        projectId: captureProjectIdentity(),
        baseRevision: projectRevision,
        intent: 'color the vocals orange',
        commands: actions.map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: 'Vocals turn orange.',
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: CONFIRMATION_ID, groupLabel: 'Color vocals', source: 'prompt' },
                })
            )
        ),
    });
    const metricGoalState = configuredLiteralMetricState(commandBatch);
    return { projectRevision, actions, commandBatch, metricGoalState };
}

describe('command commit save finalization', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('save finalization regression');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        setArrangementEventBus({ emit: () => Promise.resolve() });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        agentProjectRepairStateStore.set(null);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        seedSavableProject();
        trackStore.set({
            tracks: [createTrack('track-vocals', 'Vocals')],
            selectedTrackId: 'track-vocals',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        agentProjectRepairStateStore.set(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['Confirm', 'direct commit'] as const)(
        '%s publishes matching project, projection and durable checkpoint after a save',
        async (route) => {
            const planned = planVocalsColor();
            const proof = await getVersionedCommandBatchCommitProof(planned.commandBatch);
            const approval = compileAgentRiskApproval({
                commandBatch: planned.commandBatch,
                metricGoalState: planned.metricGoalState,
            });
            if (route === 'Confirm') {
                proposePendingActionConfirmation({
                    id: CONFIRMATION_ID,
                    prompt: 'color the vocals orange',
                    assistantMessageId: 'assistant-1',
                    actions: planned.actions,
                    actionLabels: ['Color vocals'],
                    commandBatch: planned.commandBatch,
                    metricGoalState: planned.metricGoalState,
                    agentApproval: approval,
                    executionMode: 'atomic',
                    groupId: CONFIRMATION_ID,
                    groupLabel: 'Color vocals',
                    projectRevision: planned.projectRevision,
                });
            }

            await writeProjectSave();
            let result: Awaited<
                ReturnType<typeof confirmPendingChatActions> | ReturnType<typeof executePlannedActions>
            >;
            if (route === 'Confirm') {
                result = await confirmPendingChatActions({ confirmationId: CONFIRMATION_ID });
            } else {
                result = await executePlannedActions({
                    prompt: 'color the vocals orange',
                    actions: planned.actions,
                    projectRevision: planned.projectRevision,
                    executionMode: 'atomic',
                    commandBatch: {
                        ...planned.commandBatch,
                        approvalBinding: issueAgentCommandApprovalBinding({
                            approval,
                            commandBatch: planned.commandBatch,
                        }),
                    },
                });
            }

            const root = getCrdtDoc<ProjectRoot>('root');
            if (!root) {
                throw new Error('Expected the committed project root');
            }
            const reopened = load<ProjectRoot>(save(root));
            expect.soft(root.tracks?.tracks.find((track) => track.id === 'track-vocals')?.color).toBe(APPROVED_COLOR);
            expect
                .soft(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.color)
                .toBe(APPROVED_COLOR);
            expect.soft(reopened.tracks?.tracks).toEqual(root.tracks?.tracks);
            expect.soft(result).toMatchObject({ status: route === 'Confirm' ? 'executed' : 'committed' });
            expect.soft(result).not.toHaveProperty('finalizationEvidenceFailure');
            const record = root.commandBatchIdempotency?.records.find(
                (candidate) => candidate.idempotencyKey === proof.idempotencyKey
            );
            expect(record).toMatchObject({
                projectId: proof.projectId,
                contentHash: proof.contentHash,
                state: 'complete',
            });
            expect(reopened.commandBatchIdempotency).toEqual(root.commandBatchIdempotency);
            const receipt = await getVersionedCommandBatchIdempotentReplay(planned.commandBatch);
            expect(receipt).toMatchObject({
                runId: proof.runId,
                batchId: proof.batchId,
                outcome: 'committed',
                pendingEffects: [],
            });
            expect(record?.serializedReceipt).toBe(JSON.stringify(receipt));
        }
    );
});
