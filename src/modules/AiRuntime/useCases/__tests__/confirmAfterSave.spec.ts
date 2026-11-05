import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
    type ProjectStoreState,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { beginConfirmedCommandExecution } from '../agentRequestOrchestration/beginConfirmedCommandExecution';
import { confirmationAdmission } from '../agentRequestOrchestration/resolveConfirmationAdmission';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { configuredLiteralMetricState } from './metricGoalWorkflowFixture';

const CONFIRMATION_ID = 'confirmation-after-save';
const DEFAULT_TRACK_COLOR = '#ffffff';
const APPROVED_COLOR = '#ff5500';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
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

function seedProject(): void {
    trackStore.set({
        tracks: [createTrack('track-vocals', 'Vocals'), createTrack('track-drums', 'Drums')],
        selectedTrackId: 'track-vocals',
        ghostClips: [],
    });
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
}

function currentProject(): ProjectStoreState {
    return projectStore.value ?? defaultProjectStoreState;
}

/**
 * The root writes `saveProject` performs, in its order: it publishes a fresh save timestamp, then
 * serializes through `buildProjectData`, which refreshes the active arrangement's entry from the
 * live slots. Nothing a musician edited moves.
 */
async function writeSave(): Promise<void> {
    const project = currentProject();
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function activeArrangementTrackIds(): string[] {
    const root = getCrdtDoc<{
        arrangements?: { arrangements: { id: string; tracks: { tracks: { id: string }[] } }[] };
    }>('root');
    const entry = root?.arrangements?.arrangements.find((candidate) => candidate.id === defaultArrangementId);
    return entry?.tracks.tracks.map((track) => track.id) ?? [];
}

function proposeVocalsColor(): string {
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
    proposePendingActionConfirmation({
        id: CONFIRMATION_ID,
        prompt: 'color the vocals orange',
        assistantMessageId: 'assistant-1',
        actions,
        actionLabels: ['Color vocals'],
        commandBatch,
        metricGoalState,
        agentApproval: compileAgentRiskApproval({ commandBatch, metricGoalState }),
        executionMode: 'atomic',
        groupId: CONFIRMATION_ID,
        groupLabel: 'Color vocals',
        projectRevision,
    });
    return projectRevision;
}

function vocalsColor(): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.color;
}

function renameDrums(): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: tracks.map((track) => (track.id === 'track-drums' ? { ...track, name: 'Drum Bus' } : track)),
        selectedTrackId: 'track-vocals',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function editProjectMeta(edit: (project: ProjectStoreState) => ProjectStoreState): void {
    projectStore.set(edit(currentProject()));
    flushAutomergeStorageWrites();
}

type ProjectContentEdit = { field: string; edit: (project: ProjectStoreState) => ProjectStoreState };

const PROJECT_CONTENT_EDITS: readonly ProjectContentEdit[] = [
    { field: 'project name', edit: (project) => ({ ...project, name: 'Renamed Song' }) },
    { field: 'key', edit: (project) => ({ ...project, keyRoot: 7 }) },
    { field: 'scale', edit: (project) => ({ ...project, scaleName: 'minor' }) },
    { field: 'tuning', edit: (project) => ({ ...project, tuning: { ...project.tuning, name: 'Stretched' } }) },
    {
        field: 'production brief',
        edit: (project) => ({ ...project, productionBrief: { ...project.productionBrief, vision: 'A darker mix' } }),
    },
];

const PROJECT_CONTENT_EDIT_ROWS = PROJECT_CONTENT_EDITS.flatMap((row) => [
    { ...row, saved: false },
    { ...row, saved: true },
]);

describe('Confirm after a save', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('confirm after save test');
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
        projectStore.set(defaultProjectStoreState);
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
        seedProject();
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

    it('executes the approved batch on the first Confirm after a save', async () => {
        const approvedRevision = proposeVocalsColor();

        await writeSave();

        // The save really moved root: the strict matcher sees it, and the active arrangement's entry
        // now carries the live tracks.
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(approvedRevision)).toBe(false);
        expect(activeArrangementTrackIds()).toEqual(['track-vocals', 'track-drums']);

        await expect(confirmPendingChatActions({ confirmationId: CONFIRMATION_ID })).resolves.toEqual({
            status: 'executed',
        });

        expect(vocalsColor()).toBe(APPROVED_COLOR);
        expect(getPendingActionConfirmation(CONFIRMATION_ID)?.status).toBe('executed');
    });

    it('keeps the card confirmable after a save', async () => {
        proposeVocalsColor();

        await writeSave();

        const card = getAgentApprovalView({ confirmationId: CONFIRMATION_ID });
        expect(card?.freshness.status).toBe('current');
        expect(card?.canConfirm).toBe(true);
    });

    it('marks the card stale after a track edit, saved or not', async () => {
        proposeVocalsColor();

        renameDrums();
        await writeSave();

        const card = getAgentApprovalView({ confirmationId: CONFIRMATION_ID });
        expect(card?.freshness.status).toBe('stale');
        expect(card?.canConfirm).toBe(false);
    });

    it('admits a card without a command batch after a save instead of invalidating it', async () => {
        const projectRevision = captureProjectRevision();
        proposePendingActionConfirmation({
            id: CONFIRMATION_ID,
            prompt: 'color the vocals orange',
            assistantMessageId: 'assistant-1',
            actions: [{ type: 'setTrackColor', payload: { trackId: 'track-vocals', color: APPROVED_COLOR } }],
            actionLabels: ['Color vocals'],
            executionMode: 'atomic',
            projectRevision,
        });

        await writeSave();

        const admission = await confirmationAdmission.resolveConfirmationAdmission({ confirmationId: CONFIRMATION_ID });
        expect(admission.status).toBe('ready');
        expect(getPendingActionConfirmation(CONFIRMATION_ID)?.status).toBe('proposed');
    });

    it.each([false, true])('still asks again after a track edit (saved: %s)', async (saved) => {
        proposeVocalsColor();

        renameDrums();
        if (saved) {
            await writeSave();
        }

        const result = await confirmPendingChatActions({ confirmationId: CONFIRMATION_ID });

        expect(result.status).toBe('reapproval_required');
        expect(vocalsColor()).toBe(DEFAULT_TRACK_COLOR);
        expect(getPendingActionConfirmation(CONFIRMATION_ID)?.status).toBe('proposed');
    });

    it.each(PROJECT_CONTENT_EDIT_ROWS)(
        'still asks again after a $field change (saved: $saved)',
        async ({ edit, saved }) => {
            proposeVocalsColor();

            editProjectMeta(edit);
            if (saved) {
                await writeSave();
            }

            const result = await confirmPendingChatActions({ confirmationId: CONFIRMATION_ID });

            expect(result.status).toBe('reapproval_required');
            expect(vocalsColor()).toBe(DEFAULT_TRACK_COLOR);
        }
    );

    it('refuses at execution a batch whose source revision differs in content, saved or not', async () => {
        proposeVocalsColor();
        const confirmation = getPendingActionConfirmation(CONFIRMATION_ID);
        if (!confirmation) {
            throw new Error('Expected the pending confirmation');
        }

        renameDrums();
        await writeSave();

        const execution = beginConfirmedCommandExecution({
            confirmation,
            priorVerifiedBatchReceipt: null,
            recoveringPendingEffects: false,
        });

        expect(execution.status).toBe('settled');
        expect(vocalsColor()).toBe(DEFAULT_TRACK_COLOR);
    });
});
