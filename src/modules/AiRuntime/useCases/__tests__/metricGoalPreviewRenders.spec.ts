import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createTrack, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal, type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';
import { readMeasurementRenderedSeconds } from '../readMeasurementRenderedSeconds';

import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

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
type CompiledCard = ReturnType<typeof compileAgentActionExecution>;

const RUN_ID = 'metric-goal-preview-renders';
const PROMPT = 'Darken every track and keep the vocal intimate';
const RECIPE_ID = 'bass-warm';
const EIGHT_TRACKS = ['vocal', 'bass', 'keys', 'guitar', 'drums', 'pad', 'lead', 'strings'] as const;
const SIX_TRACKS = EIGHT_TRACKS.slice(0, 6);
const THREE_TRACKS = EIGHT_TRACKS.slice(0, 3);
const RANGE = { startBeat: 0, endBeat: 4, sectionId: null };

function clip(trackId: string) {
    return {
        id: `${trackId}-clip`,
        trackId,
        name: 'Take',
        type: 'audio' as const,
        audioBufferId: `${trackId}-buffer`,
        startBeat: 0,
        endBeat: RANGE.endBeat,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function configureProject(trackIds: readonly string[]): void {
    configureMetricGoalProject({
        label: RUN_ID,
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            ...trackIds.map((id) => ({
                ...createTrack({ id, name: id.charAt(0).toUpperCase() + id.slice(1), kind: 'audio' }),
                clips: [clip(id)],
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

/** The authored recipe criterion each step is held to: its spectral centroid decreases. */
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

/**
 * One card of one recipe step per track: each step cuts its track's high band, the vocal by
 * `vocalCutDb`, and the request's "keep the vocal intimate" holds the vocal's level and dynamics.
 */
function compileRecipeCard(trackIds: readonly string[], vocalCutDb: number) {
    const actions: AppAction[] = trackIds.map((id) => ({
        type: 'setDeviceParameter',
        payload: { deviceId: `${id}-eq`, paramId: 'eq-high-gain', value: id === 'vocal' ? vocalCutDb : -6 },
    }));
    const compiled = compileAgentActionExecution({
        actions,
        actionLabels: actions.map((action) => action.type),
        context: getProjectContext(),
        intent: PROMPT,
        projectRevision: captureProjectRevision(),
        runId: RUN_ID,
        group: { groupId: 'metric-goal-preview-renders', groupLabel: PROMPT },
        requiresConfirmation: true,
    });
    const held = metricGoalStateCodec(compiled.metricGoalState);
    const parsed = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (held === null || parsed.status !== 'valid' || parsed.envelope.commands.length !== trackIds.length) {
        throw new Error('The card compiles one command per track beside the vocal holds.');
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
                authorityId: 'darken-every-track',
                origin: 'configured-joint-intake',
                callId: 'darken-intake',
                turn: 1,
                catalogId: 'metric-goal-preview-renders',
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
    return { compiled, state };
}

async function previewCard(compiled: CompiledCard, state: MetricGoalState) {
    const refreshed = await prepareMetricGoalPreview({
        state,
        commandBatch: compiled.commandBatch,
        context: getProjectContext(),
        prompt: PROMPT,
        runId: RUN_ID,
    });
    const evaluation = evaluateMetricGoalAdmission({
        state: refreshed.state,
        commandBatch: compiled.commandBatch,
        currentRevision: captureProjectRevision(),
    });
    const requests = (refreshed.state?.proofs ?? []).map((proof) => readMeasureRequest(proof, state));
    return { evaluation, receipts: refreshed.receipts, requests };
}

/**
 * What one preview measurement asked for, read from the proof it left: the prefix it measured (its
 * step count, the whole batch being every step), its subjects, metrics and range end.
 */
function readMeasureRequest(proof: MetricGoalState['proofs'][number], state: MetricGoalState) {
    const { preview } = proof;
    const step = state.steps.findIndex((candidate) => candidate.recipePrefixHash === preview.batchContentHash);
    if (step < 0) {
        throw new TypeError('Expected a proof measured at one of the card prefixes.');
    }
    const ids =
        preview.scope.kind === 'tracks' || preview.scope.kind === 'buses' ? preview.scope.ids : [preview.scope.kind];
    return {
        prefix: step + 1,
        ids: [...ids].sort(),
        metrics: Object.keys(preview.targets[0]?.baseline ?? {}).sort(),
        endBeat: preview.range.endBeat,
    };
}

/** The verdict a card earns, reduced to what the user is shown. */
function verdict(evaluation: ReturnType<typeof evaluateMetricGoalAdmission>) {
    return {
        status: evaluation.status,
        failure: evaluation.failure,
        criteria: evaluation.criteria.map((criterion) => [
            criterion.targetIds.join(','),
            criterion.metricId,
            criterion.status,
        ]),
    };
}

beforeEach(() => {
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
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
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    resetMetricGoalProject();
});

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

describe('a metric-goal preview of a card of recipe steps over eight tracks', { timeout: 120_000 }, () => {
    beforeEach(() => {
        configureProject(EIGHT_TRACKS);
        startRun();
    });

    it('renders only where admission reads, within the run render budget', async () => {
        const { compiled, state } = compileRecipeCard(EIGHT_TRACKS, -1);
        const { receipts, requests } = await previewCard(compiled, state);
        // Seven step prefixes measure the step's own track (its after) and the next step's (its before);
        // the whole batch measures every track, in shared chunks of at most four.
        expect(requests).toHaveLength(9);
        // Each track renders once live and once in each prefix it is read at: the first and last tracks
        // at two prefixes, the six between at three.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3 + 6 * 4 + 3);
        expect(receipts).toHaveLength(9);
        expect(receipts.some((receipt) => receipt.error?.code === 'measurement-budget-exhausted')).toBe(false);
        expect(receipts.every((receipt) => receipt.turn === 0 && receipt.origin === 'application-verification')).toBe(
            true
        );
    });

    it('measures a step goal at its own before and after and every goal at the whole batch', async () => {
        const { compiled, state } = compileRecipeCard(EIGHT_TRACKS, -1);
        const { requests } = await previewCard(compiled, state);
        expect(requests.map(({ prefix, ids, metrics }) => ({ prefix, ids, metrics }))).toEqual([
            ...EIGHT_TRACKS.slice(0, -1).map((id, index) => ({
                prefix: index + 1,
                ids: [id, EIGHT_TRACKS[index + 1]].sort(),
                metrics: ['spectralCentroid'],
            })),
            {
                prefix: 8,
                ids: ['bass', 'guitar', 'keys', 'vocal'],
                metrics: ['dynamicRangeEstimate', 'rms', 'spectralCentroid'],
            },
            { prefix: 8, ids: ['drums', 'lead', 'pad', 'strings'], metrics: ['spectralCentroid'] },
        ]);
    });

    it('names at most four targets per measurement and keeps each under the rendered-seconds ceiling', async () => {
        const { compiled, state } = compileRecipeCard(EIGHT_TRACKS, -1);
        const { receipts, requests } = await previewCard(compiled, state);
        const ceiling = readAgentResourceLimits().measurementRenderedSeconds;
        expect(requests.every((request) => request.ids.length <= ANALYSIS_MEASURE_MAX_TARGETS)).toBe(true);
        expect(requests.every((request) => readMeasurementRenderedSeconds(request.endBeat) <= ceiling)).toBe(true);
        expect(receipts.some((receipt) => receipt.error?.code === 'range-exceeds-ceiling')).toBe(false);
    });
});

const DYNAMIC_RANGE_REFUSAL =
    'The preview breaks “keep the vocal intimate”: estimated dynamic range on “Vocal” moved from 5.662 to 4.104 dB, beyond its 1 dB tolerance.';

function expectedVerdict(trackIds: readonly string[], vocalCutDb: number) {
    const passes = vocalCutDb === -1;
    return {
        status: passes ? 'verified' : 'blocked',
        failure: passes ? null : 'out-of-tolerance',
        criteria: [
            ...trackIds.map((id) => [id, 'spectralCentroid', 'verified']),
            ['vocal', 'dynamicRangeEstimate', passes ? 'verified' : 'blocked'],
            // Admission stops at the first refused criterion, so the RMS hold is never reached.
            ['vocal', 'rms', passes ? 'verified' : 'blocked'],
        ],
    };
}

describe('a metric-goal preview proves a six-track card the unshared preview could not', { timeout: 120_000 }, () => {
    beforeEach(() => {
        configureProject(SIX_TRACKS);
        startRun();
    });

    it.each([
        { label: 'admits a passing card', vocalCutDb: -1 },
        { label: 'refuses a card with a held metric outside tolerance', vocalCutDb: -12 },
    ])('$label', async ({ vocalCutDb }) => {
        const { compiled, state } = compileRecipeCard(SIX_TRACKS, vocalCutDb);
        const { evaluation, receipts } = await previewCard(compiled, state);
        expect(receipts.map((receipt) => receipt.status)).toEqual(Array(receipts.length).fill('success'));
        expect(verdict(evaluation)).toEqual(expectedVerdict(SIX_TRACKS, vocalCutDb));
        if (vocalCutDb !== -1) {
            expect(evaluation.reason).toBe(DYNAMIC_RANGE_REFUSAL);
        }
    });
});

describe(
    'a metric-goal preview proves an eight-track held card within one turn of receipts',
    { timeout: 120_000 },
    () => {
        beforeEach(() => {
            configureProject(EIGHT_TRACKS);
            startRun();
        });

        it.each([
            { label: 'admits a passing card', vocalCutDb: -1 },
            { label: 'refuses a card with a held metric outside tolerance', vocalCutDb: -12 },
        ])('$label', async ({ vocalCutDb }) => {
            const { compiled, state } = compileRecipeCard(EIGHT_TRACKS, vocalCutDb);
            const { evaluation, receipts } = await previewCard(compiled, state);
            expect(receipts.some((receipt) => receipt.error?.code === 'turn-receipt-budget-spent')).toBe(false);
            expect(receipts.map((receipt) => receipt.status)).toEqual(Array(9).fill('success'));
            expect(verdict(evaluation)).toEqual(expectedVerdict(EIGHT_TRACKS, vocalCutDb));
            expect(evaluation.reason).toBe(
                vocalCutDb === -1
                    ? 'The actual preview satisfies the frozen objective criteria. This does not establish perceived sound quality.'
                    : DYNAMIC_RANGE_REFUSAL
            );
        });
    }
);

describe('a metric-goal preview keeps the verdict a card earned before render sharing', { timeout: 120_000 }, () => {
    beforeEach(() => {
        configureProject(THREE_TRACKS);
        startRun();
    });

    it.each([
        { label: 'a passing card', vocalCutDb: -1 },
        { label: 'a card with a held metric outside tolerance', vocalCutDb: -12 },
    ])('admits or refuses $label exactly as before', async ({ vocalCutDb }) => {
        const { compiled, state } = compileRecipeCard(THREE_TRACKS, vocalCutDb);
        const { evaluation } = await previewCard(compiled, state);
        expect(verdict(evaluation)).toEqual(expectedVerdict(THREE_TRACKS, vocalCutDb));
        expect(evaluation.reason).toBe(
            vocalCutDb === -1
                ? 'The actual preview satisfies the frozen objective criteria. This does not establish perceived sound quality.'
                : DYNAMIC_RANGE_REFUSAL
        );
    });
});

describe('a shared preview measurement reads every metric any of its subjects needs', { timeout: 120_000 }, () => {
    // The held vocal is the second subject of the whole-batch chunk, behind a track no hold reads.
    const HELD_SECOND = ['bass', 'vocal', 'keys'] as const;

    beforeEach(() => {
        configureProject(THREE_TRACKS);
        startRun();
    });

    it.each([
        { label: 'admits a passing card', vocalCutDb: -1 },
        { label: 'refuses a card with a held metric outside tolerance', vocalCutDb: -12 },
    ])('$label whose held subject is not first in its measurement', async ({ vocalCutDb }) => {
        const { compiled, state } = compileRecipeCard(HELD_SECOND, vocalCutDb);
        const { evaluation, requests } = await previewCard(compiled, state);
        expect(requests.filter((request) => request.prefix === HELD_SECOND.length)).toEqual([
            {
                prefix: HELD_SECOND.length,
                ids: ['bass', 'keys', 'vocal'],
                metrics: ['dynamicRangeEstimate', 'rms', 'spectralCentroid'],
                endBeat: RANGE.endBeat,
            },
        ]);
        expect(verdict(evaluation)).toEqual(expectedVerdict(HELD_SECOND, vocalCutDb));
        expect(evaluation.reason).toBe(
            vocalCutDb === -1
                ? 'The actual preview satisfies the frozen objective criteria. This does not establish perceived sound quality.'
                : DYNAMIC_RANGE_REFUSAL
        );
    });
});
