import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from '../../__tests__/aiWorkflowCommandPreflightFixture';
import { executeCommittedSectionRenderRetry } from '../executeCommittedSectionRenderRetry';

// The revision gates here are the real ones, over a real CRDT document and a real save write; only
// the renderer, the run lifecycle and the chat and confirmation stores are replaced.
const mocks = vi.hoisted(() => ({
    finalizeCommandReceipt: vi.fn(),
    project: vi.fn(),
    retryRenders: vi.fn(),
    updateChat: vi.fn(),
    updateConfirmation: vi.fn(),
    updateFollowUp: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    canExecuteCommandBatchEffects: () => true,
    finalizeRecoveredCommandBatchEffects: mocks.finalizeCommandReceipt,
}));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getSectionRenderFollowUpFailure: () => null,
    retryAgentProjectSectionRenders: mocks.retryRenders,
}));

vi.mock('../../../stores/chatStore', () => ({
    chatStore: { value: { isGenerating: false } },
    setChatGenerating: () => undefined,
    updateChatMessage: mocks.updateChat,
}));

vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    getPendingActionConfirmation: () => undefined,
    replacePendingActionExecutions: () => undefined,
    updatePendingActionConfirmationStatus: mocks.updateConfirmation,
    updatePendingActionFollowUp: mocks.updateFollowUp,
}));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        claimWorkLease: () => ({ status: 'unavailable' }),
        completePendingEffectContinuation: () => undefined,
        get: () => ({ budgetAttempts: [] }),
        recordArtifact: () => undefined,
        recordPendingEffectContinuation: () => undefined,
        reconcileBudgetAttempt: () => undefined,
        reserveBudget: () => ({ status: 'reserved' }),
        settleWorkLease: () => ({ status: 'settled' }),
    },
}));

vi.mock('../projectSectionRenderConfirmation', () => ({
    projectSectionRenderConfirmation: mocks.project,
}));

vi.mock('../requireSectionRenderManualRepair', () => ({
    requireSectionRenderManualRepair: () => null,
}));

const JOB = {
    jobId: 'render-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 44_100,
    tailSeconds: 0,
};
const STALE_REASON =
    'Project changed after the committed render receipt; the missing original artifacts cannot be recreated safely.';

function createTrack(id: string): Track {
    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
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
    trackStore.set({ tracks: [createTrack('track-kick')], selectedTrackId: 'track-kick', ghostClips: [] });
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

/** The root writes `saveProject` performs: a fresh save timestamp, then `buildProjectData`'s arrangement refresh. */
async function writeSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function writeKickGain(gain: number): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: tracks.map((track) => (track.id === 'track-kick' ? { ...track, gain } : track)),
        selectedTrackId: 'track-kick',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function createInput(committedRevision: string): Parameters<typeof executeCommittedSectionRenderRetry>[0] {
    const action = {
        type: 'setTrackGain',
        payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 },
    } satisfies AppAction;
    const command = createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Set Kick gain.',
        normalizedProjectRevision: committedRevision,
        objectReferences: [{ argument: 'trackId', id: 'track-kick', scope: 'stable' }],
        parameterUnits: [
            { argument: 'gain', unit: 'linear-gain' },
            { argument: 'expectedGain', unit: 'linear-gain' },
        ],
        reason: 'Apply the approved gain.',
        time: [],
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-retry',
        batchId: 'batch-retry',
        projectId: 'project-retry',
        baseRevision: committedRevision,
        intent: 'Set Kick gain',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const durableReceipt = createVerifiedBatchReceipt({
        contentHash: 'content-retry',
        envelope: parsed.envelope,
        observedBaseRevision: committedRevision,
        resultingRevision: null,
        result: { status: 'committed', actions: [] },
    });
    return {
        commandBatch,
        durableReceipt,
        confirmation: {
            id: 'confirmation-retry',
            runId: 'run-retry',
            prompt: 'Render Verse',
            assistantMessageId: 'assistant-retry',
            actionLabels: ['Render Verse'],
            affectedIds: ['section-verse'],
            protectedUnchanged: [],
            risk: null,
            executedActions: [],
            status: 'failed',
            error: 'Renderer unavailable.',
            supersedes: null,
            supersededBy: null,
            followUpProjectRevision: committedRevision,
            followUpStatus: 'retryable',
            createdAt: 1,
            resolvedAt: 2,
            kind: 'app_actions',
            projectRevision: committedRevision,
            actions: [action],
            approvalSnapshot: { actions: [action], actionLabels: ['Render Verse'], protectedUnchanged: [] },
            executionMode: 'atomic',
            groupId: 'batch-retry',
            groupLabel: 'Render Verse',
        },
    };
}

function projectionWithIncompleteVerse(incomplete: boolean) {
    return {
        approvedSectionRenderJobs: [JOB],
        completedSectionRenderJobIds: new Set(incomplete ? [] : [JOB.jobId]),
        performedSectionRenderJobIds: new Set(incomplete ? [] : [JOB.jobId]),
        executions: [],
        incompleteSectionRenders: incomplete ? { jobs: [JOB], missingJobIds: [JOB.jobId] } : null,
        reviewRequiredSectionRenders: [],
        receipt: '- **renderProjectSections**: section-verse',
    };
}

describe('Retry renders after a save', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAiWorkflowCommandPreflightFixture();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('retry renders after save test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        agentProjectRepairStateStore.set(null);
        projectStore.set(defaultProjectStoreState);
        seedProject();
        mocks.retryRenders.mockResolvedValue(undefined);
        mocks.finalizeCommandReceipt.mockImplementation(({ pendingReceipt }) =>
            Promise.resolve({ status: 'finalized', receipt: pendingReceipt })
        );
        mocks.project
            .mockReturnValueOnce(projectionWithIncompleteVerse(true))
            .mockReturnValue(projectionWithIncompleteVerse(false));
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('runs the renders against the committed revision after a save', async () => {
        const committedRevision = captureProjectRevision();
        const input = createInput(committedRevision);

        await writeSave();
        expect(captureProjectRevision()).not.toBe(committedRevision);

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({ status: 'executed' });

        expect(mocks.retryRenders).toHaveBeenCalledWith(expect.objectContaining({ sourceRevision: committedRevision }));
        expect(mocks.finalizeCommandReceipt).toHaveBeenCalledWith(
            expect.objectContaining({ expectedProjectRevision: committedRevision })
        );
    });

    it('still refuses the retry after a track edit, saved or not', async () => {
        const committedRevision = captureProjectRevision();
        const input = createInput(committedRevision);

        writeKickGain(0.5);
        await writeSave();

        await expect(executeCommittedSectionRenderRetry(input)).resolves.toEqual({
            status: 'failed',
            reason: STALE_REASON,
        });
        expect(mocks.retryRenders).not.toHaveBeenCalled();
    });
});
