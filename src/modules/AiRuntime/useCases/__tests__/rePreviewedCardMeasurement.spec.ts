import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { createTrack, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { executeAppAction, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { chatStore } from '../../stores/chatStore';
import { getPendingActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { bindMeasuredPreviewToBatch } from '../bindMeasuredPreviewToBatch';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal, type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

/**
 * #6629: a re-preview measures the refreshed batch, so the card it leaves shows that measurement —
 * the same preview the plan's audible claim reads — and every figure either lists comes from it.
 */
const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

type RenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];

const RUN_ID = 're-previewed-card-measurement';
const PROMPT = 'Darken these tracks';
const RECIPE_ID = 'bass-warm';
const RANGE = { startBeat: 0, endBeat: 4, sectionId: null };
const EIGHT_TRACKS = ['vocal', 'bass', 'keys', 'guitar', 'drums', 'pad', 'lead', 'strings'] as const;
const THREE_TRACKS = EIGHT_TRACKS.slice(0, 3);

function configureProject(trackIds: readonly string[]): void {
    configureMetricGoalProject({
        label: RUN_ID,
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            ...trackIds.map((id) => ({
                ...createTrack({ id, name: id.charAt(0).toUpperCase() + id.slice(1), kind: 'audio' }),
                clips: [
                    {
                        id: `${id}-clip`,
                        trackId: id,
                        name: 'Take',
                        type: 'audio' as const,
                        audioBufferId: `${id}-buffer`,
                        startBeat: 0,
                        endBeat: RANGE.endBeat,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#ffffff',
                        locked: false,
                        muted: false,
                    },
                ],
                devices: [
                    {
                        id: `${id}-eq`,
                        name: 'Tone EQ',
                        type: 'builtin-eq',
                        bypassed: false,
                        parameterValues: { 'eq-low-gain': 0, 'eq-high-gain': 0 },
                    },
                ],
            })),
        ],
        sections: [],
    });
}

/** Every track sounds a 100 Hz fundamental beside a 3 kHz overtone its EQ's high band lifts or cuts. */
function renderTrack(input: RenderInput): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const highDb = track.devices.reduce((total, device) => total + (device.parameterValues['eq-high-gain'] ?? 0), 0);
    const high = 10 ** (highDb / 20);
    return metricGoalAudioBuffer(
        (time) => 0.4 * Math.sin(2 * Math.PI * 100 * time) + 0.2 * high * Math.sin(2 * Math.PI * 3000 * time),
        (input.endBeat - input.startBeat) / 2
    );
}

/** The authored recipe criterion each track's step is held to: its spectral centroid decreases. */
function recipeGoal(trackId: string): MetricGoal {
    const catalog = getMixRecipeCatalog();
    const recipe = catalog.recipes.find((entry) => entry.id === RECIPE_ID);
    const expectationIndex =
        recipe?.metrics.findIndex(
            (expectation) => expectation.metric === 'spectralCentroid' && expectation.direction === 'decrease'
        ) ?? -1;
    if (recipe === undefined || expectationIndex < 0) {
        throw new Error('The fixture recipe holds a spectral-centroid decrease.');
    }
    return {
        goalId: `recipe:${RECIPE_ID}:${trackId}:centroid`,
        stepId: `recipe:${RECIPE_ID}:${trackId}`,
        metricId: 'spectralCentroid',
        band: null,
        targetIds: [trackId],
        referenceTargetIds: [],
        range: RANGE,
        relation: 'decrease',
        targetValue: null,
        tolerance: 0,
        source: {
            kind: 'recipe',
            recipeId: RECIPE_ID,
            catalogVersion: catalog.version,
            recipeDigest: digest(recipe),
            expectationIndex,
        },
    };
}

/** One card of one recipe step per track, each cutting its track's high band. */
function compileRecipeCard(trackIds: readonly string[]) {
    const actions: AppAction[] = trackIds.map((id) => ({
        type: 'setDeviceParameter',
        payload: { deviceId: `${id}-eq`, paramId: 'eq-high-gain', value: -6 },
    }));
    const compiled = compileAgentActionExecution({
        actions,
        actionLabels: actions.map((action) => action.type),
        context: getProjectContext(),
        intent: PROMPT,
        projectRevision: captureProjectRevision(),
        runId: RUN_ID,
        group: { groupId: RUN_ID, groupLabel: PROMPT },
        requiresConfirmation: true,
    });
    const held = metricGoalStateCodec(compiled.metricGoalState);
    const parsed = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (held === null || parsed.status !== 'valid') {
        throw new Error('The card compiles one command per track.');
    }
    const envelope = parsed.envelope;
    const steps = trackIds.map((id, index) => {
        const commands = envelope.commands.slice(0, index + 1);
        const ids = new Set(commands.map((command) => command.commandId));
        return {
            stepId: `recipe:${RECIPE_ID}:${id}`,
            commandCount: 1,
            operationTypes: [envelope.commands[index]!.operation],
            recipePrefixHash: digestCommandBatchContent({
                ...envelope,
                commands,
                batchLocalBindings: envelope.batchLocalBindings.filter((binding) => ids.has(binding.producerCommandId)),
            }),
        };
    });
    const state: MetricGoalState = {
        ...held,
        steps,
        authorities: [
            {
                schemaVersion: 1,
                authorityId: 'darken-tracks',
                origin: 'configured-joint-intake',
                callId: 'darken-intake',
                turn: 1,
                catalogId: RUN_ID,
                requestDigest: digest(PROMPT),
                revision: envelope.baseRevision,
                projectId: captureProjectIdentity(),
                selection: getCreativeSelectionSnapshot(getProjectContext()),
                kind: 'perceptual',
                goals: trackIds.map(recipeGoal),
                creativeAuthority: null,
            },
            ...held.authorities,
        ],
    };
    return { actions, compiled, parsed, state };
}

function startRun(): void {
    expect(
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: PROMPT,
            mode: 'apply',
            createdRevision: captureProjectRevision(),
        })
    ).toEqual({ status: 'created' });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
}

/** The latest proof of exactly this batch at its revision: the one preview a claim may read. */
function latestBoundProof(state: MetricGoalState | null, envelope: Parameters<typeof bindMeasuredPreviewToBatch>[1]) {
    return (state?.proofs ?? []).flatMap((proof) => bindMeasuredPreviewToBatch(proof.preview, envelope) ?? []).at(-1);
}

/**
 * Measures and persists the card at the current revision, carrying its own bound proof as its
 * preview the way a measured first proposal does, under a run plan the claim is written to.
 */
async function persistMeasuredCard(trackIds: readonly string[]): Promise<string> {
    const { actions, compiled, parsed, state } = compileRecipeCard(trackIds);
    const measured = await prepareMetricGoalPreview({
        state,
        commandBatch: compiled.commandBatch,
        context: getProjectContext(),
        prompt: PROMPT,
        runId: RUN_ID,
    });
    const approval = compileAgentRiskApproval({
        commandBatch: compiled.commandBatch,
        requireExplicitApproval: true,
        metricGoalState: JSON.stringify(measured.state),
    });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: PROMPT,
        commandIds: parsed.envelope.commands.map((command) => command.commandId),
        serializedBatchIdentity: parsed.envelope.idempotencyKey,
        revision: parsed.envelope.baseRevision,
        scope: { targetIds: [...trackIds], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: { limits: {}, consumed: {} },
    });
    chatStore.set({
        messages: [{ id: 'card-message', role: 'assistant', content: 'Darken proposal', timestamp: 1 }],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
    const confirmationId = persistPromptActionConfirmation({
        runId: RUN_ID,
        prompt: PROMPT,
        assistantMessageId: 'card-message',
        actions,
        actionLabels: actions.map((action) => action.type),
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: approval,
        metricGoalState: approval.metricGoalState ?? undefined,
        affectedIds: [...trackIds],
        protectedUnchanged: [],
        measuredPreview: latestBoundProof(measured.state, parsed.envelope),
        executionMode: 'atomic',
        group: { groupId: RUN_ID, groupLabel: PROMPT },
        projectRevision: parsed.envelope.baseRevision,
        parsedCommandBatch: parsed,
        content: 'Darken proposal',
    });
    if (confirmationId === null) {
        throw new Error('The store refused the measured card.');
    }
    expect(getAgentApprovalView({ confirmationId })?.measuredPreview).not.toBeNull();
    return confirmationId;
}

/** Moves the project on to a new revision the card was not measured at. */
async function editProject(): Promise<void> {
    const before = captureProjectRevision();
    await executeAppAction({ type: 'renameTrack', payload: { trackId: 'vocal', name: 'Lead Vocal' } });
    flushAutomergeStorageWrites();
    expect(captureProjectRevision()).not.toBe(before);
}

/** Every figure the card shows as moved, in the shape the plan's audible claim lists it. */
function movedFiguresOnCard(confirmationId: string) {
    const preview = getAgentApprovalView({ confirmationId })?.measuredPreview;
    return (preview?.targets ?? []).flatMap((target) =>
        target.metrics.flatMap((metric) => {
            if (
                metric.baseline === null ||
                metric.preview === null ||
                metric.delta === null ||
                metric.delta.value === 0
            ) {
                return [];
            }
            return [
                {
                    targetId: target.targetId,
                    targetKind: target.targetKind,
                    range: preview?.range,
                    metricId: metric.metricId,
                    baseline: metric.baseline,
                    preview: metric.preview,
                    delta: metric.delta,
                },
            ];
        })
    );
}

function claimedFigures() {
    const claim = agentRunLifecycle.get(RUN_ID)?.plan?.expectedImpact.audible;
    if (claim?.status !== 'predicted') {
        throw new Error(`Expected the perceptual plan to state its predictions, got: ${JSON.stringify(claim)}`);
    }
    return claim.observed.status === 'listed' ? claim.observed.metrics : [];
}

/** The re-proposed card's preview, the proof it came from, and what card and claim list. */
function readReplacement(confirmationId: string) {
    const replacement = getPendingActionConfirmation(confirmationId);
    const batch = replacement?.approvalSnapshot.commandBatch;
    const parsed = batch && parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    if (parsed?.status !== 'valid') {
        throw new Error('Expected the re-proposed card to hold its refreshed batch.');
    }
    const state = metricGoalStateCodec(replacement?.approvalSnapshot.metricGoalState);
    return {
        snapshotPreview: replacement?.approvalSnapshot.measuredPreview,
        boundProof: latestBoundProof(state, parsed.envelope),
        boundProofCount: (state?.proofs ?? []).filter(
            (proof) => bindMeasuredPreviewToBatch(proof.preview, parsed.envelope) !== undefined
        ).length,
        viewPreview: getAgentApprovalView({ confirmationId })?.measuredPreview ?? null,
        onCard: movedFiguresOnCard(confirmationId),
        claimed: claimedFigures(),
    };
}

beforeEach(() => {
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input: RenderInput) => renderTrack(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped goal must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A goal must be measured on its rendered scope, never on source audio.');
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    resetMetricGoalProject();
});

describe('a re-previewed card shows the measurement its re-preview made', { timeout: 120_000 }, () => {
    // Red when the replacement carries the old card's preview, which persistence drops at the new
    // revision, so the card shows none while the plan claims the fresh figures.
    it('shows the fresh bound proof after a project edit, and the plan claims exactly its figures', async () => {
        configureProject(THREE_TRACKS);
        startRun();
        const confirmationId = await persistMeasuredCard(THREE_TRACKS);
        await editProject();

        const reproposed = await reproposePendingChatActions({ confirmationId });

        expect(reproposed).toMatchObject({ status: 'reproposed' });
        if (reproposed.status !== 'reproposed') {
            throw new Error('Expected the re-preview to replace the card.');
        }
        const replacement = readReplacement(reproposed.confirmationId);
        expect(replacement.boundProof?.revision).toBe(captureProjectRevision());
        expect(replacement.snapshotPreview).toEqual(replacement.boundProof);
        expect(replacement.viewPreview?.targets.map((target) => target.targetId).sort()).toEqual(
            [...THREE_TRACKS].sort()
        );
        expect(replacement.onCard.length).toBeGreaterThan(0);
        expect(replacement.claimed).toEqual(replacement.onCard);
    });

    // Red when the card shows one proof while the claim merges several, listing figures the card never shows.
    it('carries the latest of several bound proofs, and the claim lists only what that one shows', async () => {
        configureProject(EIGHT_TRACKS);
        startRun();
        const confirmationId = await persistMeasuredCard(EIGHT_TRACKS);
        await editProject();

        const reproposed = await reproposePendingChatActions({ confirmationId });

        expect(reproposed).toMatchObject({ status: 'reproposed' });
        if (reproposed.status !== 'reproposed') {
            throw new Error('Expected the re-preview to replace the card.');
        }
        const replacement = readReplacement(reproposed.confirmationId);
        // Eight targets measure the whole batch in two chunks of four, each a proof of this exact batch.
        expect(replacement.boundProofCount).toBe(2);
        expect(replacement.snapshotPreview).toEqual(replacement.boundProof);
        expect(replacement.viewPreview?.targets.map((target) => target.targetId).sort()).toEqual(
            ['drums', 'lead', 'pad', 'strings'].sort()
        );
        expect(replacement.claimed).toEqual(replacement.onCard);
    });

    // Red when a subset measured fresh is still treated as a change nobody measured.
    it('shows the fresh bound proof of a subset re-proposal, and the plan claims exactly its figures', async () => {
        configureProject(THREE_TRACKS);
        startRun();
        const confirmationId = await persistMeasuredCard(THREE_TRACKS);
        await editProject();
        const [kept] = getAgentApprovalView({ confirmationId })?.intentGroups ?? [];
        if (kept === undefined) {
            throw new Error('Expected the card to offer its intent groups.');
        }

        const reproposed = await reproposePendingChatActions({ confirmationId, selectedIntentGroupIds: [kept.id] });

        expect(reproposed).toMatchObject({ status: 'reproposed' });
        if (reproposed.status !== 'reproposed') {
            throw new Error('Expected the subset re-preview to replace the card.');
        }
        expect(getPendingActionConfirmation(reproposed.confirmationId)?.actions).toHaveLength(1);
        const replacement = readReplacement(reproposed.confirmationId);
        expect(replacement.boundProof?.revision).toBe(captureProjectRevision());
        expect(replacement.snapshotPreview).toEqual(replacement.boundProof);
        expect(replacement.onCard.length).toBeGreaterThan(0);
        expect(replacement.claimed).toEqual(replacement.onCard);
    });
});
