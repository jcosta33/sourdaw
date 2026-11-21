import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type BriefReadingPlan } from '../../models/BriefReading';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { type persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { describeBriefReadings } from '../vibeRun/describeBriefReadings';
import { describeRePreviewedBriefReadings } from '../vibeRun/describeRePreviewedBriefReadings';

import { configuredLiteralMetricState } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

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
    stop: vi.fn(async () => ({ status: 'idle' })),
    appendChatMessage: vi.fn(),
    cancelRun: vi.fn(),
    compileApproval: vi.fn(),
    compilePartial: vi.fn(),
    getRun: vi.fn(),
    persistConfirmation: vi.fn<typeof persistPromptActionConfirmation>(),
    preview: vi.fn(),
    recordBatch: vi.fn(),
    refresh: vi.fn(),
    release: vi.fn(),
    settleBestEffort: vi.fn(),
    transitionPhase: vi.fn(),
    updateBatchStatus: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('../stopMeasuredPreviewAudition', () => ({ stopMeasuredPreviewAudition: mocks.stop }));

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
        projectId: captureProjectIdentity(),
        baseRevision,
        intent: 'Set Kick, Snare and Hat gain to 80%',
        commands,
    });
}

const originalBatch = buildBatch('batch-original', ORIGINAL_REVISION, [0, 1, 2]);
const refreshedBatch = buildBatch('batch-refreshed', CURRENT_REVISION, [0, 1, 2]);
const subsetBatch = buildBatch('batch-subset', CURRENT_REVISION, [0, 2]);

const AGENT_APPROVAL = {
    schemaVersion: 1 as const,
    explicitApprovalRequired: true,
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

function propose(
    id: string,
    actions: readonly AppAction[] = TRACK_IDS.map((trackId) => gainAction(trackId)),
    adoptedRecipes?: Parameters<typeof proposePendingActionConfirmation>[0]['adoptedRecipes'],
    protectionFacts?: Parameters<typeof proposePendingActionConfirmation>[0]['protectionFacts'],
    metricGoalState: string | null = configuredLiteralMetricState(originalBatch),
    recorded: Partial<Parameters<typeof proposePendingActionConfirmation>[0]> = {}
) {
    const confirmation = proposePendingActionConfirmation({
        id,
        runId: 'run-repropose',
        prompt: 'Set Kick, Snare and Hat gain to 80%',
        assistantMessageId: 'assistant-original',
        actions: [...actions],
        actionLabels: [...ACTION_LABELS],
        commandBatch: originalBatch,
        agentApproval: { ...AGENT_APPROVAL, metricGoalState },
        metricGoalState: metricGoalState ?? undefined,
        adoptedRecipes,
        protectionFacts,
        affectedIds: [...TRACK_IDS],
        groupId: 'group-repropose',
        groupLabel: 'Rebalance the drums',
        projectRevision: ORIGINAL_REVISION,
        ...recorded,
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

function readingPlan(planDigest: string): BriefReadingPlan {
    return { batches: [], planDigest, trackNames: {}, constraintReading: { constraints: [], unsupported: [] } };
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
        mocks.compileApproval.mockImplementation((input: { metricGoalState?: string }) => ({
            ...AGENT_APPROVAL,
            sourceRevision: CURRENT_REVISION,
            metricGoalState: input.metricGoalState,
        }));
        mocks.getRun.mockReturnValue({ runId: 'run-repropose', phase: 'waiting-for-approval' });
        mocks.persistConfirmation.mockReturnValue('confirmation-reproposed');
        mocks.refresh.mockReturnValue(readyRefresh(refreshedBatch));
    });

    afterEach(() => {
        clearPendingActionConfirmations();
    });

    it.each([false, true])('keeps independent protection facts when re-proposing subset=%s', async (subset) => {
        const protectionFacts = {
            protectedUnchanged: [{ id: 'track-keys', name: 'Keys' }],
            protectedControls: [
                { trackId: 'track-vocals', operations: ['setTrackGain'] },
                { trackId: 'track-bass', operations: [], exceptOperations: ['setTrackGain'] },
            ],
        };
        propose('confirmation-protection-facts', undefined, undefined, protectionFacts);
        if (subset) {
            mocks.preview.mockReturnValue(previewedSelection());
            mocks.compilePartial.mockReturnValue({
                status: 'compiled',
                authority: subsetBatch.authority,
                serialized: subsetBatch.serialized,
                includedOriginalCommandIds: [COMMAND_IDS[0], COMMAND_IDS[2]],
            });
            mocks.refresh.mockReturnValue(readyRefresh(subsetBatch));
        }

        const options: Parameters<typeof reproposePendingChatActions>[0] = {
            confirmationId: 'confirmation-protection-facts',
        };
        if (subset) {
            options.selectedIntentGroupIds = [COMMAND_IDS[2]];
        }
        const result = await reproposePendingChatActions(options);

        expect(result.status).toBe('reproposed');
        expect(mocks.persistConfirmation).toHaveBeenCalledWith(expect.objectContaining({ protectionFacts }));
    });

    it.each(['missing', 'empty'] as const)(
        'refuses an unadmitted legacy proposal with %s intent without opening a preview or creating another card',
        async (kind) => {
            let state: string | null = null;
            if (kind === 'empty') {
                state = JSON.stringify({ schemaVersion: 1, authorities: [], steps: [], proofs: [], binding: null });
            }
            const legacy = propose('confirmation-no-intent', undefined, undefined, undefined, state);
            await expect(reproposePendingChatActions({ confirmationId: legacy.id })).resolves.toEqual({
                status: 'rejected',
                reason: 'Submit the request again to establish its whole-request intent.',
            });
            expect(mocks.refresh).not.toHaveBeenCalled();
            expect(mocks.compileApproval).not.toHaveBeenCalled();
            expect(mocks.preview).not.toHaveBeenCalled();
            expect(mocks.persistConfirmation).not.toHaveBeenCalled();
            expect(mocks.appendChatMessage).not.toHaveBeenCalled();
            expect(getPendingActionConfirmation(legacy.id)).toMatchObject({ status: 'proposed', supersededBy: null });
        }
    );

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

        mocks.refresh.mockImplementationOnce(() => {
            expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({ confirmationId: 'confirmation-stale' });
            return readyRefresh(refreshedBatch);
        });

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

    // Red when the replacement card says only that it was re-previewed and drops the description of
    // what it changes (#6551).
    it('keeps the card description of the refreshed batch beside the re-preview sentence', async () => {
        propose('confirmation-described');
        mocks.refresh.mockReturnValue(readyRefresh(refreshedBatch));

        await expect(reproposePendingChatActions({ confirmationId: 'confirmation-described' })).resolves.toMatchObject({
            status: 'reproposed',
        });

        const persisted = mocks.persistConfirmation.mock.calls.at(-1)?.[0];
        if (persisted === undefined) {
            throw new TypeError('Expected the re-preview to persist its replacement card');
        }
        const { content } = persisted;
        expect(content.startsWith('This prompt requires confirmation before execution.')).toBe(true);
        expect(content.match(/^- \*\*setTrackGain\*\*: /gmu)).toHaveLength(3);
        expect(content.endsWith('\n\nRe-previewed against the current project.')).toBe(true);
        expect(mocks.appendChatMessage).toHaveBeenCalledWith(expect.objectContaining({ content }));
    });

    // Red when a re-previewed brief card drops the lines its first proposal showed after the description (#7142).
    it.each([
        {
            kind: 'ambiguous brief readings',
            lines: [
                'This request reads more than one way. Confirm records the brief only.',
                '- Reading "Warm": warm, dark',
                '- Reading "Open": airy, bright',
            ],
        },
        {
            kind: 'scheduled brief no-batches line',
            lines: [
                'No batches were scheduled after the brief: initial measurements require a live run, original revision, cancellation signal and budget admission.',
            ],
        },
    ])('keeps the $kind lines on a whole re-preview', async ({ lines }) => {
        propose('confirmation-brief', undefined, undefined, undefined, undefined, { plannedRunLines: lines });

        await reproposePendingChatActions({ confirmationId: 'confirmation-brief' });

        const persisted = mocks.persistConfirmation.mock.calls.at(-1)?.[0];
        expect(
            persisted?.content.endsWith(`\n\n${lines.join('\n')}\n\nRe-previewed against the current project.`)
        ).toBe(true);
        expect(persisted?.plannedRunLines).toEqual(lines);
        expect(mocks.appendChatMessage).toHaveBeenCalledWith(expect.objectContaining({ content: persisted?.content }));
    });

    // Red when the offered readings are carried: their goals stay bound to the original revision, so a choice would plan with superseded goals.
    it('carries no offered brief readings onto a whole or a subset re-preview', async () => {
        const briefReadings: NonNullable<Parameters<typeof proposePendingActionConfirmation>[0]['briefReadings']> = {
            catalogId: 'catalog',
            metricGoalState: 'state',
            readings: [
                { id: 'r1', name: 'Warm', descriptors: ['warm'], plan: readingPlan('digest-warm') },
                { id: 'r2', name: 'Bright', descriptors: ['bright', 'airy'], plan: readingPlan('digest-bright') },
            ],
            brief: {
                schemaVersion: 1,
                id: 'brief-1',
                revision: 1,
                vision: null,
                references: [],
                hardConstraints: [],
                preferences: [],
                sectionGoals: [],
                trackRoles: [],
                locks: [],
                decisions: [],
                unresolvedQuestions: [],
                sourceRunLinks: [],
                supersedesBriefId: null,
                supersededByBriefId: null,
                createdAt: 0,
                updatedAt: 0,
            },
            trustCeiling: null,
        };
        propose('confirmation-readings', undefined, undefined, undefined, undefined, {
            briefReadings,
            plannedRunLines: describeBriefReadings(briefReadings.readings),
        });
        await reproposePendingChatActions({ confirmationId: 'confirmation-readings' });
        const whole = mocks.persistConfirmation.mock.calls.at(-1)?.[0];
        expect(whole?.briefReadings).toBeUndefined();
        // The card must not promise a choice it can no longer honour: no reading control survives the re-preview.
        expect(whole?.content).not.toContain('Choosing a reading plans');
        expect(whole?.plannedRunLines).not.toContain(describeBriefReadings(briefReadings.readings).at(-1));
        const rePreviewedLines = describeRePreviewedBriefReadings(briefReadings.readings);
        expect(whole?.plannedRunLines).toEqual(rePreviewedLines);
        expect(whole?.content).toContain(rePreviewedLines.join('\n'));

        propose('confirmation-readings-subset', undefined, undefined, undefined, undefined, {
            briefReadings,
            plannedRunLines: describeBriefReadings(briefReadings.readings),
        });
        mocks.preview.mockReturnValue(previewedSelection());
        mocks.compilePartial.mockReturnValue({
            status: 'compiled',
            authority: subsetBatch.authority,
            serialized: subsetBatch.serialized,
            includedOriginalCommandIds: [COMMAND_IDS[0], COMMAND_IDS[2]],
        });
        mocks.refresh.mockReturnValue(readyRefresh(subsetBatch));
        await reproposePendingChatActions({
            confirmationId: 'confirmation-readings-subset',
            selectedIntentGroupIds: [COMMAND_IDS[2]],
        });
        const subset = mocks.persistConfirmation.mock.calls.at(-1)?.[0];
        expect(subset?.briefReadings).toBeUndefined();
        expect(subset?.plannedRunLines).toBeUndefined();
        expect(subset?.content).not.toContain('reads more than one way');
    });

    // Red when the re-previewed refinement card omits the note its kept actions carried at first proposal (#7142).
    it('notes the actions a refinement kept in the re-previewed content', async () => {
        propose('confirmation-kept', undefined, undefined, undefined, undefined, {
            keptDirectionActionIndexes: [1],
            workflowCapabilityId: 'drum-routing',
        });

        await reproposePendingChatActions({ confirmationId: 'confirmation-kept' });

        const persisted = mocks.persistConfirmation.mock.calls.at(-1)?.[0];
        const intended = persisted?.content.match(/^- \*\*setTrackGain\*\*: .*$/gmu) ?? [];
        expect(intended).toHaveLength(3);
        expect(intended.map((line) => line.includes('(direction kept from the pending proposal)'))).toEqual([
            false,
            true,
            false,
        ]);
        expect(persisted?.keptDirectionActionIndexes).toEqual([1]);
        expect(persisted?.workflowCapabilityId).toBe('drum-routing');
    });

    // Red when a subset re-preview keeps the original positions, noting the wrong action.
    it('moves the kept-direction positions with the actions a subset keeps', async () => {
        propose('confirmation-kept-subset', undefined, undefined, undefined, undefined, {
            keptDirectionActionIndexes: [2],
        });
        mocks.preview.mockReturnValue(previewedSelection());
        mocks.compilePartial.mockReturnValue({
            status: 'compiled',
            authority: subsetBatch.authority,
            serialized: subsetBatch.serialized,
            includedOriginalCommandIds: [COMMAND_IDS[0], COMMAND_IDS[2]],
        });
        mocks.refresh.mockReturnValue(readyRefresh(subsetBatch));

        await reproposePendingChatActions({
            confirmationId: 'confirmation-kept-subset',
            selectedIntentGroupIds: [COMMAND_IDS[2]],
        });

        const persisted = mocks.persistConfirmation.mock.calls.at(-1)?.[0];
        const intended = persisted?.content.match(/^- \*\*setTrackGain\*\*: .*$/gmu) ?? [];
        expect(intended.map((line) => line.includes('(direction kept from the pending proposal)'))).toEqual([
            false,
            true,
        ]);
        expect(persisted?.keptDirectionActionIndexes).toEqual([1]);
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

    // Red when a whole re-proposal forgets which recipes built the batch it replaces.
    it('carries the adopted recipes onto a whole re-proposal', async () => {
        const adoptedRecipes = [{ recipeId: 'vocal-warm', title: 'Chest-register lift', targetId: TRACK_IDS[0] }];
        propose('confirmation-recipes-whole', undefined, adoptedRecipes);

        const result = await reproposePendingChatActions({ confirmationId: 'confirmation-recipes-whole' });

        expect(result).toMatchObject({ status: 'reproposed' });
        expect(mocks.persistConfirmation).toHaveBeenCalledWith(expect.objectContaining({ adoptedRecipes }));
    });

    // Red when a subset re-proposal claims recipe provenance for a batch it has already cut down.
    it('drops the adopted recipes from a subset re-proposal rather than guess which survive', async () => {
        propose('confirmation-recipes-subset', undefined, [
            { recipeId: 'vocal-warm', title: 'Chest-register lift', targetId: TRACK_IDS[0] },
        ]);
        mocks.preview.mockReturnValue(previewedSelection());
        mocks.compilePartial.mockReturnValue({
            status: 'compiled',
            authority: subsetBatch.authority,
            serialized: subsetBatch.serialized,
            includedOriginalCommandIds: [COMMAND_IDS[0], COMMAND_IDS[2]],
        });
        mocks.refresh.mockReturnValue(readyRefresh(subsetBatch));

        await reproposePendingChatActions({
            confirmationId: 'confirmation-recipes-subset',
            selectedIntentGroupIds: [COMMAND_IDS[2]],
        });

        expect(mocks.persistConfirmation).toHaveBeenCalledOnce();
        expect(mocks.persistConfirmation.mock.calls[0]?.[0]?.adoptedRecipes).toBeUndefined();
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
