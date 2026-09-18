import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

const ORIGINAL_REVISION = 'revision-original';
const CURRENT_REVISION = 'revision-current';
const COMMAND_IDS = [
    '44444444-4444-4444-8444-444444444441',
    '44444444-4444-4444-8444-444444444442',
    '44444444-4444-4444-8444-444444444443',
] as const;
const TRACK_IDS = ['track-kick', 'track-snare', 'track-hat'] as const;
const ACTION_LABELS = ['Set Kick gain', 'Set Snare gain', 'Set Hat gain'] as const;

const mocks = vi.hoisted(() => ({
    appendChatMessage: vi.fn(),
    cancelRun: vi.fn(),
    compileApproval: vi.fn(),
    compilePartial: vi.fn(),
    getRun: vi.fn(),
    persistConfirmation: vi.fn(),
    preview: vi.fn(),
    recordBatch: vi.fn(),
    refresh: vi.fn(),
    release: vi.fn(),
    settleBestEffort: vi.fn(),
    transitionPhase: vi.fn(),
    updateBatchStatus: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    compilePartialCommandBatchAcceptance: mocks.compilePartial,
    previewVersionedCommandBatchEnvelope: mocks.preview,
    refreshVersionedCommandBatchForApproval: mocks.refresh,
}));

vi.mock('../../stores/chatStore', () => ({
    appendChatMessage: mocks.appendChatMessage,
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../agentRequestOrchestration/pendingActionResourceSettlement', () => ({
    pendingActionResourceSettlement: { settleBestEffort: mocks.settleBestEffort },
}));

vi.mock('../agentRequestOrchestration/persistPromptActionConfirmation', () => ({
    persistPromptActionConfirmation: mocks.persistConfirmation,
}));

vi.mock('../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        cancelRun: mocks.cancelRun,
        get: mocks.getRun,
        recordBatch: mocks.recordBatch,
        transitionPhase: mocks.transitionPhase,
        updateBatchStatus: mocks.updateBatchStatus,
    },
}));

vi.mock('../compileAgentRiskApproval', () => ({
    compileAgentRiskApproval: mocks.compileApproval,
}));

const { compileVersionedCommandBatchEnvelope, createVersionedCommandEnvelope, serializeVersionedCommandEnvelope } =
    await import('#/modules/Command/useCases');

function gainAction(trackId: string): AppAction {
    return { type: 'setTrackGain', payload: { trackId, gain: 0.8, expectedGain: 1 } };
}

function buildBatch(batchId: string, baseRevision: string, indexes: readonly number[]) {
    const commands = indexes.map((index) =>
        serializeVersionedCommandEnvelope({
            ...createVersionedCommandEnvelope({
                action: gainAction(TRACK_IDS[index]!),
                availableDeviceVersions: {},
                expectedEffect: `Set the ${TRACK_IDS[index]!} gain to 0.8.`,
                normalizedProjectRevision: baseRevision,
                objectReferences: [{ argument: 'trackId', id: TRACK_IDS[index]!, scope: 'stable' }],
                parameterUnits: [
                    { argument: 'gain', unit: 'linear-gain' },
                    { argument: 'expectedGain', unit: 'linear-gain' },
                ],
                reason: 'Rebalance the drums.',
                time: [],
            }),
            commandId: COMMAND_IDS[index]!,
        })
    );
    return compileVersionedCommandBatchEnvelope({
        runId: 'run-repropose',
        batchId,
        projectId: 'project-repropose',
        baseRevision,
        intent: 'Rebalance the drums',
        commands,
    });
}

const originalBatch = buildBatch('batch-original', ORIGINAL_REVISION, [0, 1, 2]);
const refreshedBatch = buildBatch('batch-refreshed', CURRENT_REVISION, [0, 1, 2]);
const subsetBatch = buildBatch('batch-subset', CURRENT_REVISION, [0, 2]);

const AGENT_APPROVAL = {
    schemaVersion: 1 as const,
    actionHashes: ['hash-kick', 'hash-snare', 'hash-hat'],
    sourceRevision: ORIGINAL_REVISION,
    targetFingerprints: {},
    advertisedTargetFingerprints: {},
    consequences: {
        audioUpload: false,
        fileAccess: false,
        maxImportedAssets: 0,
        maxRenderJobs: 0,
        remoteGeneration: false,
    },
    localActorId: 'actor-repropose',
    policy: {
        decision: 'confirm' as const,
        reasons: ['Changes existing tracks.'],
        requiredTrustMode: 'apply-reversible' as const,
        risk: 'bounded-reversible' as const,
    },
};

function stemImportAction(): AppAction {
    return {
        type: 'importStemSet',
        payload: {
            selectionId: 'selection-repropose',
            groupName: 'Drums',
            projectTempo: 120,
            folderId: 'folder-repropose',
            stems: [
                {
                    stemId: 'stem-kick',
                    sourceName: 'kick.wav',
                    role: 'kick',
                    sourceTempo: 120,
                    durationSeconds: 4,
                    sourceBytes: 1024,
                    decodedBytes: 4096,
                    audioBufferId: 'buffer-kick',
                    trackId: TRACK_IDS[0],
                    trackName: 'Kick',
                    trackGain: 1,
                    trackPan: 0,
                    clipId: 'clip-kick',
                },
            ],
        },
    };
}

function propose(id: string, actions: readonly AppAction[] = TRACK_IDS.map((trackId) => gainAction(trackId))) {
    const confirmation = proposePendingActionConfirmation({
        id,
        runId: 'run-repropose',
        prompt: 'Rebalance the drums',
        assistantMessageId: 'assistant-original',
        actions: [...actions],
        actionLabels: [...ACTION_LABELS],
        commandBatch: originalBatch,
        agentApproval: AGENT_APPROVAL,
        affectedIds: [...TRACK_IDS],
        groupId: 'group-repropose',
        groupLabel: 'Rebalance the drums',
        projectRevision: ORIGINAL_REVISION,
    });
    if (!confirmation) {
        throw new Error('The store refused the proposal.');
    }
    return confirmation;
}

function readyRefresh(batch: ReturnType<typeof buildBatch>) {
    return {
        status: 'ready' as const,
        commandBatch: batch,
        commandEnvelopes: ['envelope-refreshed'],
        currentRevision: CURRENT_REVISION,
    };
}

function previewedSelection() {
    return {
        status: 'previewed' as const,
        partialAcceptance: { selectionToken: 'token-repropose' },
        resource: { release: mocks.release },
    };
}

describe('reproposePendingChatActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPendingActionConfirmations();
        mocks.compileApproval.mockReturnValue({ ...AGENT_APPROVAL, sourceRevision: CURRENT_REVISION });
        mocks.getRun.mockReturnValue({ runId: 'run-repropose', phase: 'waiting-for-approval' });
        mocks.persistConfirmation.mockReturnValue('confirmation-reproposed');
        mocks.refresh.mockReturnValue(readyRefresh(refreshedBatch));
    });

    afterEach(() => {
        clearPendingActionConfirmations();
    });

    // Red when an unknown confirmation id is re-proposed instead of reported missing.
    it('reports a confirmation the store does not hold', async () => {
        await expect(reproposePendingChatActions({ confirmationId: 'absent' })).resolves.toEqual({ status: 'missing' });
        expect(mocks.persistConfirmation).not.toHaveBeenCalled();
    });

    // Red when a settled confirmation can still be replaced, overwriting its receipts.
    it('refuses a confirmation that already settled', async () => {
        propose('confirmation-executed');
        updatePendingActionConfirmationStatus({ confirmationId: 'confirmation-executed', status: 'executed' });

        await expect(reproposePendingChatActions({ confirmationId: 'confirmation-executed' })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'executed',
        });
        expect(mocks.persistConfirmation).not.toHaveBeenCalled();
    });

    // Red when an invalidated proposal is replaced, because the store refuses to supersede it again
    // and the replacement would leave the original standing with the run reported as re-proposed.
    it('refuses a confirmation the settlement path already invalidated', async () => {
        propose('confirmation-invalidated');
        updatePendingActionConfirmationStatus({ confirmationId: 'confirmation-invalidated', status: 'invalidated' });

        await expect(reproposePendingChatActions({ confirmationId: 'confirmation-invalidated' })).resolves.toEqual({
            status: 'not_pending',
            currentStatus: 'invalidated',
        });
        expect(mocks.persistConfirmation).not.toHaveBeenCalled();
        expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    });

    // Red when a proposal whose run already ended is replaced onto that run, which accepts no further batch.
    it.each(['completed', 'failed', 'cancelled', 'partially-completed'] as const)(
        'refuses a proposal whose run is already %s',
        async (phase) => {
            propose(`confirmation-run-${phase}`);
            mocks.getRun.mockReturnValue({ runId: 'run-repropose', phase });

            await expect(reproposePendingChatActions({ confirmationId: `confirmation-run-${phase}` })).resolves.toEqual(
                { status: 'rejected', reason: `The run this proposal belongs to is already ${phase}.` }
            );
            expect(mocks.persistConfirmation).not.toHaveBeenCalled();
            expect(mocks.appendChatMessage).not.toHaveBeenCalled();
        }
    );

    // Red when a proposal whose run the store no longer holds is replaced against a run that cannot record it.
    it('refuses a proposal whose run the lifecycle no longer holds', async () => {
        propose('confirmation-run-absent');
        mocks.getRun.mockReturnValue(null);

        await expect(reproposePendingChatActions({ confirmationId: 'confirmation-run-absent' })).resolves.toEqual({
            status: 'rejected',
            reason: 'The run this proposal belongs to is no longer recorded.',
        });
        expect(mocks.persistConfirmation).not.toHaveBeenCalled();
        expect(mocks.appendChatMessage).not.toHaveBeenCalled();
    });

    // Red when a proposal holding prepared stems is replaced: retiring it discards the lease whose
    // release frees the very audio buffers and staged asset leases the replacement still names.
    it('refuses a proposal holding prepared stem resources before any write', async () => {
        propose('confirmation-stems', [stemImportAction()]);

        await expect(reproposePendingChatActions({ confirmationId: 'confirmation-stems' })).resolves.toEqual({
            status: 'rejected',
            reason: 'This proposal holds prepared stem resources. Cancel it and ask again to re-prepare them.',
        });
        expect(mocks.appendChatMessage).not.toHaveBeenCalled();
        expect(mocks.persistConfirmation).not.toHaveBeenCalled();
        expect(mocks.settleBestEffort).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirmation-stems')).toMatchObject({
            status: 'proposed',
            supersededBy: null,
        });
    });

    // Red when the replacement is not bound to the superseded proposal, or the run is torn down with it.
    it('replaces the whole proposal against the current revision and keeps the run alive', async () => {
        propose('confirmation-stale');

        const result = await reproposePendingChatActions({ confirmationId: 'confirmation-stale' });

        expect(result).toEqual({
            status: 'reproposed',
            confirmationId: 'confirmation-reproposed',
            supersededConfirmationId: 'confirmation-stale',
            includedIntentGroupIds: [...COMMAND_IDS],
        });
        expect(mocks.persistConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: 'run-repropose',
                supersedes: 'confirmation-stale',
                projectRevision: CURRENT_REVISION,
                actionLabels: [...ACTION_LABELS],
                affectedIds: [...TRACK_IDS],
                group: { groupId: 'group-repropose', groupLabel: 'Rebalance the drums' },
            })
        );
        expect(mocks.preview).not.toHaveBeenCalled();
        const superseded = getPendingActionConfirmation('confirmation-stale');
        expect(superseded).toMatchObject({
            status: 'invalidated',
            error: 'Superseded by a re-preview against the current project.',
            supersededBy: 'confirmation-reproposed',
        });
        expect(mocks.settleBestEffort).toHaveBeenCalledWith({
            confirmationId: 'confirmation-stale',
            disposition: 'discard',
        });
        expect(mocks.updateChatMessage).toHaveBeenCalledWith('assistant-original', {
            pendingActionConfirmationStatus: 'invalidated',
            error: 'Superseded by a re-preview against the current project.',
            content: 'This proposal was replaced by a re-preview against the current project.',
        });
        expect(mocks.appendChatMessage).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'assistant', isCommandAction: true })
        );
        expect(mocks.recordBatch).toHaveBeenCalledWith({
            runId: 'run-repropose',
            batch: {
                batchId: 'batch-refreshed',
                commandIds: [...COMMAND_IDS],
                status: 'waiting-for-approval',
                receiptIdentity: null,
            },
        });
        expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
            runId: 'run-repropose',
            batchId: 'batch-original',
            status: 'cancelled',
        });
        expect(mocks.cancelRun).not.toHaveBeenCalled();
        expect(mocks.transitionPhase).not.toHaveBeenCalled();
    });

    // Red when a partial selection re-proposes actions its dependency closure never included.
    it('re-proposes only the selected groups and the prerequisites they drag in', async () => {
        propose('confirmation-partial');
        mocks.preview.mockReturnValue(previewedSelection());
        mocks.compilePartial.mockReturnValue({
            status: 'compiled',
            authority: subsetBatch.authority,
            serialized: subsetBatch.serialized,
            includedOriginalCommandIds: [COMMAND_IDS[0], COMMAND_IDS[2]],
        });
        mocks.refresh.mockReturnValue(readyRefresh(subsetBatch));

        const result = await reproposePendingChatActions({
            confirmationId: 'confirmation-partial',
            selectedIntentGroupIds: [COMMAND_IDS[2]],
        });

        expect(result).toEqual({
            status: 'reproposed',
            confirmationId: 'confirmation-reproposed',
            supersededConfirmationId: 'confirmation-partial',
            includedIntentGroupIds: [COMMAND_IDS[0], COMMAND_IDS[2]],
        });
        expect(mocks.compilePartial).toHaveBeenCalledWith(
            expect.objectContaining({
                previewSelection: { selectionToken: 'token-repropose' },
                runId: 'run-repropose',
                selectedIntentGroupIds: [COMMAND_IDS[2]],
            })
        );
        expect(mocks.refresh).toHaveBeenCalledWith({
            authority: subsetBatch.authority,
            serialized: subsetBatch.serialized,
        });
        expect(mocks.persistConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({
                actionLabels: [ACTION_LABELS[0], ACTION_LABELS[2]],
                actions: [gainAction(TRACK_IDS[0]), gainAction(TRACK_IDS[2])],
                affectedIds: [TRACK_IDS[0], TRACK_IDS[2]],
            })
        );
        expect(mocks.release).toHaveBeenCalledOnce();
    });

    // Red when selecting every group still opens a preview workspace to partition a batch it keeps whole.
    it('skips partial compilation when the selection covers every group', async () => {
        propose('confirmation-all-groups');

        const result = await reproposePendingChatActions({
            confirmationId: 'confirmation-all-groups',
            selectedIntentGroupIds: [...COMMAND_IDS],
        });

        expect(result).toMatchObject({ status: 'reproposed', includedIntentGroupIds: [...COMMAND_IDS] });
        expect(mocks.preview).not.toHaveBeenCalled();
        expect(mocks.compilePartial).not.toHaveBeenCalled();
    });

    // Red when a conflicted preview still retires the proposal the musician is still holding.
    it('leaves the proposal untouched when the preview conflicts', async () => {
        propose('confirmation-conflicted');
        mocks.preview.mockReturnValue({ status: 'conflicted', reason: 'The project moved under the preview.' });

        const result = await reproposePendingChatActions({
            confirmationId: 'confirmation-conflicted',
            selectedIntentGroupIds: [COMMAND_IDS[2]],
        });

        expect(result).toEqual({ status: 'conflicted', reason: 'The project moved under the preview.' });
        expect(mocks.persistConfirmation).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation('confirmation-conflicted')).toMatchObject({
            status: 'proposed',
            supersededBy: null,
        });
    });

    // Red when a refused replacement retires the proposal it failed to replace. Persistence is
    // mocked here, so this observes the confirmation store alone, not the run the real persist writes.
    it('leaves the stored proposal untouched when the replacement is not retained', async () => {
        propose('confirmation-refused');
        mocks.persistConfirmation.mockReturnValue(null);

        const result = await reproposePendingChatActions({ confirmationId: 'confirmation-refused' });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Prepared action resources exceed the live confirmation limit.',
        });
        expect(getPendingActionConfirmation('confirmation-refused')).toMatchObject({
            status: 'proposed',
            error: null,
            supersededBy: null,
        });
        expect(mocks.settleBestEffort).not.toHaveBeenCalled();
        expect(mocks.recordBatch).not.toHaveBeenCalled();
    });
});
