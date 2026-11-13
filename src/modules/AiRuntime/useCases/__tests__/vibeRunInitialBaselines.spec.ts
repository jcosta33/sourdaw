import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    initEngineDeviceCollaborators,
    removeTrackStrip,
    type renderTrackSubgraphOffline,
} from '#/modules/AudioEngine/useCases';
import { registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { undo, executeAppAction, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { resetCrdtProjectAuthority, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { ANALYSIS_MEASURE_MAX_TARGETS } from '../../models/AnalysisMeasureLimits';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { type MeasuredScheduledVibeRunPlan } from '../../models/VibeRunPlan';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { agentRunCancellation } from '../cancelAgentRun';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';
import { formatVibeFigure } from '../vibeRun/formatVibeFigure';
import { planVibeRunSchedule } from '../vibeRun/planVibeRunSchedule';

import {
    isRecord,
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';
import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import { seedSavableProject, writeProjectSave, moveTrackFader } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * AC-003 of #4372: a whole-project request plans a measured run of recipe batches behind its brief.
 * The brief is confirmed first; each batch is then grounded at the revision the batch before it left,
 * previewed and measured, and approved on its own, and the run stops cleanly on a reject or a refusal.
 */
const PROMPT = 'make this mix warmer and more open';
const BRIEF_REVISION = 4;
const PLANNED_BRIEF_REVISION = BRIEF_REVISION + 1;

const DRUMS_ID = 'track-drums';
const VOCAL_ID = 'track-vocal';
const BASS_ID = 'track-bass';

// Complete-run cases perform 27 real PCM reads and three history transactions under concurrent CI.
const MULTI_BATCH_TEST_TIMEOUT_MS = 15_000;

const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'openai', model: 'hosted-model', baseUrl: 'https://api.openai.com/v1' }),
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted provider planning request.');
    }),
}));

// A committed batch builds a live strip and its EQ filters on this context, whose stubbed params
// carry no schedulable timeline, so only the per-parameter write to a live node is stubbed below.
vi.hoisted(() => {
    const OriginalAudioContext = globalThis.AudioContext;
    const createAudioParam = (value: number) => ({
        value,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
    });
    const createNode = () => ({
        connect: (destination: unknown) => destination,
        disconnect: () => undefined,
    });
    function AudioContextWithDeviceNodes(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return Object.assign(context, {
            currentTime: 0,
            createStereoPanner: () => ({ ...createNode(), pan: createAudioParam(0) }),
            createBiquadFilter: () => ({
                ...createNode(),
                type: 'lowpass',
                frequency: createAudioParam(350),
                Q: createAudioParam(1),
                gain: createAudioParam(0),
                detune: createAudioParam(0),
            }),
        });
    }
    Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        writable: true,
        value: AudioContextWithDeviceNodes,
    });
    const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;
    class AudioWorkletNodeWithClosablePort extends OriginalAudioWorkletNode {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
            super(context, name, options);
            if (typeof this.port.close !== 'function') {
                Object.defineProperty(this.port, 'close', { configurable: true, value: () => undefined });
            }
        }
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        writable: true,
        value: AudioWorkletNodeWithClosablePort,
    });
});

/** The verification-receipt allowance, overridden live so one case can shrink it below what its reads hold. */
const verificationLimits = vi.hoisted((): { maxBytesPerCollection: number | null } => ({
    maxBytesPerCollection: null,
}));
vi.mock('../readApplicationVerificationReceiptLimits', async (importOriginal) => {
    const original = await importOriginal<typeof import('../readApplicationVerificationReceiptLimits')>();
    return {
        ...original,
        readApplicationVerificationReceiptLimits: (collectionReceipts: number) => {
            const limits = original.readApplicationVerificationReceiptLimits(collectionReceipts);
            const { maxBytesPerCollection } = verificationLimits;
            return maxBytesPerCollection === null ? limits : { ...limits, maxBytesPerCollection };
        },
    };
});

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn<typeof renderTrackSubgraphOffline>(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    updateDeviceParam: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

type RenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];
type ProviderRequest = { userMessage: string; schemas: readonly ToolSchema[] };
type ScriptedPlanningTurn = (request: ProviderRequest) => ToolCallResult[];
type ProductionBrief = NonNullable<typeof projectStore.value>['productionBrief'];
type Confirmation = NonNullable<typeof pendingActionConfirmationStore.value>['confirmations'][number];

const briefIntake: ScriptedPlanningTurn = ({ userMessage, schemas }) => {
    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
    const base = selectCreativeInterpretationCall({ catalog, modeId: 'brief' });
    return [
        {
            ...base,
            id: 'brief-intake',
            arguments: {
                ...base.arguments,
                answer: null,
                metricIntent: { kind: 'non-acoustic', uncertainty: 'none', objectives: [] },
            },
        },
    ];
};

const compileBrief: ScriptedPlanningTurn = () => [
    {
        id: 'brief-compile',
        name: 'brief.compile',
        arguments: {
            vision: 'A warmer, more open mix',
            mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: ['warm'] },
        },
    },
];

const proposeBrief: ScriptedPlanningTurn = () => [
    {
        id: 'brief-proposal',
        name: 'command.batch.propose',
        arguments: {
            commands: [],
            compiledCallIds: ['brief-compile'],
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Record the project intent the request describes.',
                constraints: [],
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                capabilityIds: [],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Compare the brief revision before writing.'],
                stoppingConditions: ['Stop if the brief changes before Confirm.'],
            },
        },
    },
];

const BRIEF_ROUTE = [briefIntake, compileBrief, proposeBrief];

function scriptPlanningTurns(turns: readonly ScriptedPlanningTurn[]): ProviderRequest[] {
    const requests: ProviderRequest[] = [];
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        const request = { userMessage, schemas };
        requests.push(request);
        const turn = turns[requests.length - 1];
        if (turn === undefined) {
            throw new Error(`Expected at most ${String(turns.length)} provider turns`);
        }
        return { status: 'complete', toolCalls: turn(request) };
    });
    return requests;
}

function clip(trackId: string) {
    return {
        id: `${trackId}-clip`,
        trackId,
        name: 'Take',
        type: 'audio' as const,
        audioBufferId: `${trackId}-buffer`,
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function sourceTrack(id: string, name: string) {
    return { ...createTrack({ id, name, kind: 'audio' }), clips: [clip(id)] };
}

function seededBrief(): ProductionBrief {
    return {
        ...structuredClone(defaultProjectStoreState.productionBrief),
        revision: BRIEF_REVISION,
        createdAt: 100,
        updatedAt: 100,
    };
}

/**
 * A render as the song it holds: its first frame is the song at its start beat (two beats a second),
 * so every range read out of a wider render holds that range's own samples.
 */
function renderSong(input: RenderInput, sample: (songSeconds: number) => number): AudioBuffer {
    const startSeconds = input.startBeat / 2;
    return metricGoalAudioBuffer((time) => sample(startSeconds + time), (input.endBeat - input.startBeat) / 2);
}

/**
 * Every track sounds a 100 Hz body beside a 3 kHz top, each scaled by the low and high shelf gains
 * of the EQs it carries, so a warming recipe raises the bass band and lowers the centroid; the top is
 * brighter from the chorus on.
 */
function trackSample(input: RenderInput, chorusStart = 2): (songSeconds: number) => number {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const parameter = (id: string) =>
        track.devices.reduce((total, device) => total + (device.parameterValues[id] ?? 0), 0);
    const low = 10 ** (parameter('eq-low-gain') / 20);
    const high = 10 ** (parameter('eq-high-gain') / 20);
    const frequency = input.targetTrackId === DRUMS_ID ? 100 : 220;
    return (song) => {
        const brightness = song >= chorusStart / 2 ? 0.35 : 0.15;
        return (
            0.4 * low * Math.sin(2 * Math.PI * frequency * song) +
            brightness * high * Math.sin(2 * Math.PI * 3000 * song)
        );
    };
}

function renderTrack(input: RenderInput, chorusStart = 2): AudioBuffer {
    return renderSong(input, trackSample(input, chorusStart));
}

async function sendChatMessage(prompt: string, options?: Parameters<typeof sendChatMessageWithoutDocumentFlush>[1]) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt, options);
}

function proposedCards(): Confirmation[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? []).filter((card) => card.status === 'proposed');
}

function requireOnlyProposedCard(): Confirmation {
    const cards = proposedCards();
    if (cards.length !== 1 || cards[0] === undefined) {
        const last = chatStore.value?.messages.at(-1);
        throw new TypeError(
            `Expected one proposed card, found ${String(cards.length)}: ${last?.error ?? last?.content ?? 'no reply'}`
        );
    }
    return cards[0];
}

function cardContent(card: Confirmation): string {
    return chatStore.value?.messages.find((message) => message.id === card.assistantMessageId)?.content ?? '';
}

function lastMessage(): string {
    return chatStore.value?.messages.at(-1)?.content ?? '';
}

function trackDeviceTypes(trackId: string): string[] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.devices.map((device) => device.type) ?? [];
}

function liveBriefRevision(): number {
    return projectStore.value?.productionBrief.revision ?? -1;
}

/** Sends the request and confirms its brief card, so the run proposes its first batch. */
async function confirmBrief(prompt = PROMPT): Promise<Confirmation> {
    scriptPlanningTurns(BRIEF_ROUTE);
    await sendChatMessage(prompt);
    const brief = requireOnlyProposedCard();
    await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
    return brief;
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'multi-batch vibe run test',
        tracks: [sourceTrack(DRUMS_ID, 'Drums'), sourceTrack(VOCAL_ID, 'Vocal'), sourceTrack(BASS_ID, 'Bass')],
        sections: [
            { id: 'verse', name: 'Verse', startBeat: 0, endBeat: 2, color: '#ffffff' },
            { id: 'chorus', name: 'Chorus', startBeat: 2, endBeat: 4, color: '#ffffff' },
        ],
    });
    registerHandlerMap(getProjectHandlers());
    initEngineDeviceCollaborators();
    setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' as const }),
        clear: () => undefined,
    });
    clearAiHistory();
    setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
    landProjectEdit(() => {
        projectStore.set({ ...structuredClone(defaultProjectStoreState), productionBrief: seededBrief() });
    });
    vi.mocked(generateToolPlanningOutcome).mockReset();
    runtimeMocks.backend.value = 'cloud';
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input: RenderInput) => renderTrack(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped batch must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A batch must be measured on its rendered scope, never on source audio.');
    });
});

afterEach(() => {
    verificationLimits.maxBytesPerCollection = null;
    for (const trackId of [DRUMS_ID, VOCAL_ID, BASS_ID]) {
        removeTrackStrip(trackId);
    }
    audioEngine.setUseCaseDeviceCollaborators(null);
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    clearAiHistory();
    resetMetricGoalProject();
    vi.restoreAllMocks();
});

function measuredPlan(card: Confirmation): MeasuredScheduledVibeRunPlan {
    const schedule = agentRunLifecycle.get(card.runId)?.plan?.batchSchedule;
    if (schedule?.kind !== 'vibe-run') {
        throw new Error('Expected a measured schedule.');
    }
    const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
    if (plan?.schemaVersion !== 2) {
        throw new Error('Expected frozen initial evidence.');
    }
    return plan;
}
function initialFigures(plan: MeasuredScheduledVibeRunPlan) {
    return plan.initial.receipts.flatMap((receipt) => {
        const read = readVibeRunInitialReceipt(receipt);
        if (read === null) {
            throw new Error('Expected an admitted initial receipt.');
        }
        return read.data.targets.map((target) => ({ ...target, range: read.data.range }));
    });
}
function keepDrumsOnly() {
    const state = trackStore.value;
    if (state === null) {
        throw new Error('Missing tracks.');
    }
    landProjectEdit(() => trackStore.set({ ...state, tracks: state.tracks.filter((track) => track.id === DRUMS_ID) }));
}

/** Five drum tracks, roles stated in the brief: more targets than one measurement unit holds, so initial figures take two units. */
const DRUM_KIT = ['Kick', 'Snare', 'Hats', 'Toms', 'Overheads'] as const;

function useDrumKit() {
    landProjectEdit(() => {
        const state = trackStore.value;
        if (state === null) {
            throw new Error('Missing tracks.');
        }
        const ids = DRUM_KIT.map((name) => `track-${name.toLowerCase()}`);
        trackStore.set({ ...state, tracks: DRUM_KIT.map((name, index) => sourceTrack(ids[index]!, name)) });
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: {
                ...seededBrief(),
                trackRoles: ids.map((trackId) => ({ id: `role-${trackId}`, trackId, role: 'drums', createdAt: 100 })),
            },
        });
    });
}

function useShortMeasuredSections() {
    const tracks = trackStore.value;
    if (tracks === null) {
        throw new Error('Missing tracks.');
    }
    landProjectEdit(() => {
        trackStore.set({
            ...tracks,
            tracks: tracks.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((item) => ({ ...item, endBeat: 2 })),
            })),
        });
        markerStore.set({
            markers: [],
            sections: [
                { id: 'verse', name: 'Verse', startBeat: 0, endBeat: 1, color: '#ffffff' },
                { id: 'chorus', name: 'Chorus', startBeat: 1, endBeat: 2, color: '#ffffff' },
            ],
        });
    });
    audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => renderTrack(input, 1));
}

function expectMeasuredBatch(card: Confirmation, trackId: string) {
    const view = getAgentApprovalView({ confirmationId: card.id });
    expect(view?.canConfirm).toBe(true);
    expect(view?.metricGoals.status).toBe('verified');
    expect(
        view?.metricGoals.criteria.map(({ metricId, relation, targetIds, range, status }) => ({
            metricId,
            relation,
            targetIds,
            range,
            status,
        }))
    ).toEqual(
        ['frequencyBandEnergy', 'spectralCentroid'].flatMap((metricId) =>
            [
                { startBeat: 0, endBeat: 2, sectionId: null },
                { startBeat: 0, endBeat: 1, sectionId: 'verse' },
                { startBeat: 1, endBeat: 2, sectionId: 'chorus' },
            ].map((range) => ({
                metricId,
                relation: metricId === 'frequencyBandEnergy' ? 'increase' : 'decrease',
                targetIds: [trackId],
                range,
                status: 'verified',
            }))
        )
    );
}

describe('initial role and exact-section baselines through the brief pipeline', () => {
    it('collects unequal real PCM figures before the brief card and freezes them in its serialized plan', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        const initialRevision = captureProjectRevision();
        await sendChatMessage(PROMPT);
        const card = requireOnlyProposedCard();
        const schedule = agentRunLifecycle.get(card.runId)?.plan?.batchSchedule;
        expect(schedule?.kind).toBe('vibe-run');
        if (schedule?.kind !== 'vibe-run') {
            throw new Error('Expected the measured vibe schedule');
        }
        const plan = measuredPlan(card);
        expect(plan.initial.sourceRevision).toBe(initialRevision);
        expect(plan.initial.receipts).toHaveLength(3);
        const figures = initialFigures(plan);
        expect(figures).toHaveLength(9);
        expect(new Set(figures.map((figure) => figure.artifact.contentAddress)).size).toBeGreaterThan(3);
        expect(
            new Set(
                figures.map((figure) =>
                    figure.measurements.spectralCentroid?.status === 'measured'
                        ? figure.measurements.spectralCentroid.value
                        : null
                )
            ).size
        ).toBeGreaterThan(2);
        const centroid = (targetId: string, sectionId: string) => {
            const entry = figures.find((figure) => figure.targetId === targetId && figure.range.sectionId === sectionId)
                ?.measurements.spectralCentroid;
            if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
                throw new Error('Expected a finite real centroid.');
            }
            return entry.value;
        };
        expect(centroid(DRUMS_ID, 'chorus')).toBeGreaterThan(centroid(DRUMS_ID, 'verse'));
        expect(centroid(VOCAL_ID, 'verse')).toBeGreaterThan(centroid(DRUMS_ID, 'verse'));
        for (const figure of figures) {
            const entry = figure.measurements.spectralCentroid;
            if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
                throw new Error('Expected a real centroid.');
            }
            expect(cardContent(card)).toContain(formatVibeFigure(entry.value, entry.unit));
            expect(figure.artifact.frameCount).toBeGreaterThan(0);
        }
        expect(cardContent(card)).toContain('Initial measurement');
        expect(cardContent(card)).toContain('Verse');
        expect(cardContent(card)).toContain('Chorus');
        expect(cardContent(card)).toContain('before the brief was approved');
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(vi.mocked(generateToolPlanningOutcome)).toHaveBeenCalledTimes(3);
    });

    it('fits one drum target and two sections at exactly three renders, six reductions and five commands', async () => {
        keepDrumsOnly();
        agentResourceLimitsStore.set({
            ...DEFAULT_AGENT_RESOURCE_LIMITS,
            // One initial render covers the arrangement and both sections; the preview renders live and the batch once.
            maxRenderJobs: 3,
            localAnalysis: 6,
            maxCommands: 5,
        });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
        const initial = structuredClone(measuredPlan(brief).initial);
        const batch = requireOnlyProposedCard();
        expect(batch.actions.map((action) => action.type)).toEqual([
            'addDevice',
            'setDeviceParameter',
            'setDeviceParameter',
            'setDeviceParameter',
        ]);
        expect(
            batch.actions
                .filter((action) => action.type === 'setDeviceParameter')
                .map((action) => action.payload.paramId)
        ).toEqual(['eq-low-gain', 'eq-high-freq', 'eq-high-gain']);
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule?.totalCommands).toBe(5);
        const state = metricGoalStateCodec(batch.approvalSnapshot.metricGoalState);
        expect(
            new Set(state?.authorities.flatMap((authority) => authority.goals.map((goal) => goal.range?.sectionId)))
        ).toEqual(new Set([null, 'verse', 'chorus']));
        expect(state?.proofs.every((proof) => proof.preview.revision !== initial.sourceRevision)).toBe(true);
        await expect(confirmPendingChatActions({ confirmationId: batch.id })).resolves.toEqual({ status: 'executed' });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3);
        expect(agentRunLifecycle.get(brief.runId)?.budgets.consumed).toMatchObject({
            maxRenderJobs: 3,
            localAnalysis: 6,
            maxCommands: 5,
        });
        expect(
            agentRunLifecycle
                .get(brief.runId)
                ?.batches.filter((batch) => batch.status === 'committed')
                .reduce((total, batch) => total + batch.commandIds.length, 0)
        ).toBe(5);
        expect(measuredPlan(brief).initial).toEqual(initial);
        expect(lastMessage()).toContain('approval preview, verse');
        expect(lastMessage()).toContain('approval preview, chorus');
    });

    it.each([
        { maxRenderJobs: 2, localAnalysis: 6, category: 'maxRenderJobs', needed: '3 renders' },
        { maxRenderJobs: 3, localAnalysis: 5, category: 'localAnalysis', needed: '6 reductions' },
        { maxRenderJobs: 3, localAnalysis: 6, maxCommands: 4, category: 'maxCommands', needed: '5 commands' },
    ])('refuses an impossible complete run before rendering ($category)', async ({ category, needed, ...limits }) => {
        keepDrumsOnly();
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, ...limits });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const card = requireOnlyProposedCard();
        expect(agentRunLifecycle.get(card.runId)?.plan?.batchSchedule).toBeUndefined();
        expect(cardContent(card)).toContain(needed);
        expect(cardContent(card)).toContain(category);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
    });

    it('blocks a failed fresh section while the arrangement improves and applies no recipe', async () => {
        keepDrumsOnly();
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        const initial = measuredPlan(brief).initial;
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            const track = input.renderTracks.find((track) => track.id === input.targetTrackId);
            const sounding = trackSample(input);
            if ((track?.devices.length ?? 0) === 0) {
                return renderTrack(input);
            }
            // The processed chorus loses its body and turns harsh, while the verse still improves.
            return renderSong(input, (song) => {
                if (song < 1) {
                    return sounding(song);
                }
                return 0.01 * Math.sin(2 * Math.PI * 100 * song) + 0.6 * Math.sin(2 * Math.PI * 3000 * song);
            });
        });
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
        const batch = requireOnlyProposedCard();
        expect(cardContent(batch)).toContain('chorus [2, 4]');
        expect(cardContent(batch)).toContain('(blocked)');
        expect(cardContent(batch)).toContain('arrangement [0, 4]');
        await expect(confirmPendingChatActions({ confirmationId: batch.id })).resolves.toMatchObject({
            status: 'failed',
        });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(measuredPlan(brief).initial).toEqual(initial);
    });

    it.each([
        'save',
        'pending edit',
        'flushed edit',
        'saved edit',
        'edit and revert',
        'identity',
        'section',
        'role',
        'tempo',
        'brief',
    ] as const)('handles %s while initial rendering is held', async (change) => {
        keepDrumsOnly();
        seedSavableProject();
        landProjectEdit(() =>
            projectStore.set({ ...structuredClone(defaultProjectStoreState), productionBrief: seededBrief() })
        );
        scriptPlanningTurns(BRIEF_ROUTE);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const initialRevision = captureProjectRevision();
        const originalGain = trackStore.value?.tracks.find((track) => track.id === DRUMS_ID)?.gain;
        if (originalGain === undefined) {
            throw new Error('Missing drums track gain.');
        }
        audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
            entered.resolve();
            await release.promise;
            return renderTrack(input);
        });
        const planning = sendChatMessage(PROMPT);
        await entered.promise;
        if (change === 'save') {
            await writeProjectSave();
        } else if (change === 'identity') {
            resetCrdtProjectAuthority('replacement-project');
        } else if (change === 'role') {
            await executeAppAction({ type: 'renameTrack', payload: { trackId: DRUMS_ID, name: 'Bass' } });
        } else if (change === 'tempo') {
            const state = transportStore.value;
            if (state === null) {
                throw new Error('Missing transport.');
            }
            transportStore.set({ ...state, tempo: 90 });
        } else if (change === 'brief') {
            const brief = projectStore.value?.productionBrief;
            if (brief === undefined) {
                throw new Error('Missing brief.');
            }
            await executeAppAction({
                type: 'setProductionBrief',
                payload: {
                    expectedRevision: brief.revision,
                    brief: { ...brief, revision: brief.revision + 1, vision: 'New intent' },
                },
            });
        } else if (change === 'section') {
            const state = markerStore.value;
            if (state === null) {
                throw new Error('Missing section map.');
            }
            markerStore.set({
                ...state,
                sections: state.sections.map((section) => ({ ...section, endBeat: section.endBeat + 1 })),
            });
        } else if (change === 'pending edit') {
            const state = trackStore.value;
            if (state === null) {
                throw new Error('Missing tracks.');
            }
            trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, gain: 0.5 })) });
        } else {
            moveTrackFader(DRUMS_ID, 0.5);
            if (change === 'edit and revert') {
                expect(captureProjectRevision()).not.toBe(initialRevision);
                moveTrackFader(DRUMS_ID, originalGain);
                expect(trackStore.value?.tracks.find((track) => track.id === DRUMS_ID)?.gain).toBe(originalGain);
                expect(captureProjectRevision()).not.toBe(initialRevision);
            }
            if (change === 'saved edit') {
                await writeProjectSave();
            }
        }
        release.resolve();
        await planning;
        if (change === 'save') {
            const brief = requireOnlyProposedCard();
            expect(measuredPlan(brief).initial.sourceRevision).toBe(initialRevision);
            expect(measuredPlan(brief).initial.receipts).toHaveLength(3);
        } else {
            expect(proposedCards()).toEqual([]);
            expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        }
        // The held render is the only one: it covers the arrangement and both sections.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
    });

    it('cancels a held initial render and settles its work without reviving a proposal on late completion', async () => {
        keepDrumsOnly();
        scriptPlanningTurns(BRIEF_ROUTE);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
            entered.resolve();
            await release.promise;
            return renderTrack(input);
        });
        const planning = sendChatMessage(PROMPT);
        await entered.promise;
        const run = readAgentRunState().runs.at(-1);
        if (run === undefined) {
            throw new Error('Missing active run.');
        }
        await agentRunCancellation.cancel({ runId: run.runId, reason: 'Cancelled by user' });
        release.resolve();
        await planning;
        const settled = agentRunLifecycle.get(run.runId);
        expect(settled?.workLeases.every((lease) => lease.terminalState !== null)).toBe(true);
        expect(settled?.budgets.consumed).toMatchObject({ maxRenderJobs: 1, localAnalysis: 0 });
        expect(proposedCards()).toEqual([]);
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
    });

    it(
        'retains historical provenance through brief and two batch commits and rejects tampered restoration',
        async () => {
            useShortMeasuredSections();
            const brief = await confirmBrief();
            const initial = structuredClone(measuredPlan(brief).initial);
            expect(initial.receipts).toHaveLength(3);
            expect(initialFigures(measuredPlan(brief))).toHaveLength(9);
            for (let index = 0; index < 2; index += 1) {
                const batch = requireOnlyProposedCard();
                expectMeasuredBatch(batch, index === 0 ? DRUMS_ID : VOCAL_ID);
                expect(batch.projectRevision).not.toBe(initial.sourceRevision);
                await expect(confirmPendingChatActions({ confirmationId: batch.id })).resolves.toEqual({
                    status: 'executed',
                });
                expect(measuredPlan(brief).initial).toEqual(initial);
            }
            const serializedState = JSON.stringify(readAgentRunState());
            const state: unknown = JSON.parse(serializedState);
            expect(
                sanitizeAgentRunState(state).runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule
            ).toEqual(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule);
            const plan = measuredPlan(brief);
            for (const tamper of [
                (value: typeof plan) => ({ ...value, schemaVersion: 3 }),
                (value: typeof plan) => ({ ...value, initial: { ...value.initial, sourceRevisionDigest: 'wrong' } }),
                (value: typeof plan) => ({
                    ...value,
                    initial: { ...value.initial, witnesses: value.initial.witnesses.slice(1) },
                }),
                (value: typeof plan) => ({
                    ...value,
                    initial: { ...value.initial, witnesses: [...value.initial.witnesses, value.initial.witnesses[0]] },
                }),
                (value: typeof plan) => ({
                    ...value,
                    batches: value.batches.map((batch) => ({ ...batch, witnessIds: [] })),
                }),
            ]) {
                expect(readScheduledVibeRunPlan(JSON.stringify(tamper(structuredClone(plan))))).toBeNull();
            }
            // Three targets render once for every range, and each of the three batch previews twice.
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(9);
        },
        MULTI_BATCH_TEST_TIMEOUT_MS
    );

    it.each([
        'missing section',
        'wrong unit',
        'wrong version',
        'nonfinite',
        'duplicate',
        'missing low-mid band',
        'too-short',
        'below-gate',
        'silent and measured',
        'silent and too-short',
        'duplicate silent',
    ] as const)('refuses incomplete exact-range decomposition: %s', async (defect) => {
        keepDrumsOnly();
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const plan = measuredPlan(requireOnlyProposedCard());
        let measurements = plan.initial.receipts.map((receipt) => {
            const read = readVibeRunInitialReceipt(structuredClone(receipt));
            if (read === null) {
                throw new Error('Missing actual initial receipt');
            }
            return read.data;
        });
        const chorus = measurements.find((measurement) => measurement.range.sectionId === 'chorus');
        const target = chorus?.targets[0];
        if (chorus === undefined || target === undefined) {
            throw new Error('Missing chorus witness');
        }
        const silent = { status: 'unavailable', reason: 'silent' } as const;
        if (defect === 'missing section') {
            measurements = measurements.filter((measurement) => measurement !== chorus);
        } else if (defect === 'too-short' || defect === 'below-gate') {
            Object.assign(target.measurements, {
                spectralCentroid: { status: 'unavailable', reason: defect },
                frequencyBandEnergy: { status: 'unavailable', reason: defect },
            });
        } else if (defect === 'silent and measured') {
            Object.assign(target.measurements, { frequencyBandEnergy: silent });
        } else if (defect === 'silent and too-short') {
            Object.assign(target.measurements, {
                spectralCentroid: silent,
                frequencyBandEnergy: { status: 'unavailable', reason: 'too-short' },
            });
        } else if (defect === 'duplicate silent') {
            Object.assign(target.measurements, { spectralCentroid: silent, frequencyBandEnergy: silent });
            measurements.push(structuredClone(chorus));
        } else if (defect === 'duplicate') {
            measurements.push(structuredClone(chorus));
        } else if (defect === 'missing low-mid band') {
            const entry = target.measurements.frequencyBandEnergy;
            if (entry?.status !== 'measured' || typeof entry.value !== 'object' || Array.isArray(entry.value)) {
                throw new Error('Missing band map');
            }
            Object.assign(entry, {
                value: Object.fromEntries(Object.entries(entry.value).filter(([band]) => band !== 'low-mid')),
            });
        } else {
            const entry = target.measurements.spectralCentroid;
            if (entry?.status !== 'measured') {
                throw new Error('Missing centroid');
            }
            if (defect === 'wrong unit') {
                Object.assign(entry, { unit: 'LUFS' });
            }
            if (defect === 'wrong version') {
                Object.assign(entry, { metricVersion: 2 });
            }
            if (defect === 'nonfinite') {
                Object.assign(entry, { value: Number.NaN });
            }
        }
        const result = planWholeProjectVibeRun({
            context: getProjectContext(),
            descriptors: [defect === 'missing low-mid band' ? 'muddy' : 'warm'],
            recipes: getMixRecipeCatalog().recipes.filter((recipe) => recipe.origin === undefined),
            measurements,
            requiredRanges: plan.batches[0]?.verificationRanges,
        });
        expect(result.coverageRefusals).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    targetId: DRUMS_ID,
                    range: expect.objectContaining({ sectionId: 'chorus' }),
                }),
            ])
        );
        expect(result.batches.flatMap((batch) => batch.silentRanges)).toEqual([]);
        expect(result.excludedTargets).toEqual([]);
        if (defect === 'missing low-mid band') {
            expect(result.coverageRefusals).toContainEqual(
                expect.objectContaining({ metric: 'frequencyBandEnergy', band: 'low-mid' })
            );
        }
    });

    it('schedules around a silent required section and never invents zero as its figure', async () => {
        keepDrumsOnly();
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            const sounding = trackSample(input);
            return renderSong(input, (song) => (song >= 1 ? 0 : sounding(song)));
        });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const card = requireOnlyProposedCard();
        const plan = measuredPlan(card);
        expect(plan.batches[0]?.silentRanges?.map((cell) => cell.range)).toEqual([
            { startBeat: 2, endBeat: 4, sectionId: 'chorus' },
        ]);
        expect(plan.initial.witnesses.some((witness) => witness.range.sectionId === 'chorus')).toBe(false);
        const content = cardContent(card);
        expect(content).toContain('No goal for Drums over Chorus [2, 4]: it is silent there.');
        expect(content).not.toContain('Initial measurement on Drums, Chorus');
        expect(content).not.toContain(formatVibeFigure(0, 'hertz'));
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
        await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
        const batch = requireOnlyProposedCard();
        const state = metricGoalStateCodec(batch.approvalSnapshot.metricGoalState);
        expect(
            new Set(state?.authorities.flatMap((authority) => authority.goals.map((goal) => goal.range?.sectionId)))
        ).toEqual(new Set([null, 'verse']));
        expect(state?.proofs.some((proof) => proof.preview.range.sectionId === 'chorus')).toBe(false);
        expect(cardContent(batch)).not.toContain('chorus [2, 4]');
    });

    it.each(['Confirm', 'Re-preview'] as const)(
        'refuses parked %s after the section map changes, without Command or Undo effects',
        async (operation) => {
            keepDrumsOnly();
            await confirmBrief();
            const batch = requireOnlyProposedCard();
            const markers = markerStore.value;
            if (markers === null) {
                throw new Error('Missing sections');
            }
            landProjectEdit(() =>
                markerStore.set({
                    ...markers,
                    sections: markers.sections.map((section) =>
                        section.id === 'chorus' ? { ...section, endBeat: 5 } : section
                    ),
                })
            );
            const tracks = structuredClone(trackStore.value);
            const history = structuredClone(undoHistoryStore.value);
            const renders = audio.renderTrackSubgraphOffline.mock.calls.length;
            let outcome;
            if (operation === 'Confirm') {
                outcome = await confirmPendingChatActions({ confirmationId: batch.id });
            } else {
                outcome = await reproposePendingChatActions({ confirmationId: batch.id });
            }
            expect(outcome).toMatchObject({
                status: operation === 'Confirm' ? 'failed' : 'rejected',
                reason: expect.stringContaining('section map'),
            });
            expect(trackStore.value).toEqual(tracks);
            expect(undoHistoryStore.value).toEqual(history);
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(renders);
        }
    );

    it.each(['Confirm', 'Re-preview'] as const)('refuses parked %s after a real role edit', async (operation) => {
        keepDrumsOnly();
        await confirmBrief();
        const batch = requireOnlyProposedCard();
        await executeAppAction({ type: 'renameTrack', payload: { trackId: DRUMS_ID, name: 'Bass' } });
        const tracks = structuredClone(trackStore.value);
        const history = structuredClone(undoHistoryStore.value);
        const renders = audio.renderTrackSubgraphOffline.mock.calls.length;
        let outcome;
        if (operation === 'Confirm') {
            outcome = await confirmPendingChatActions({ confirmationId: batch.id });
        } else {
            outcome = await reproposePendingChatActions({ confirmationId: batch.id });
        }
        expect(outcome).toMatchObject({
            status: operation === 'Confirm' ? 'failed' : 'rejected',
            reason: expect.stringContaining('changed role'),
        });
        expect(trackStore.value).toEqual(tracks);
        expect(undoHistoryStore.value).toEqual(history);
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(renders);
    });

    it('keeps a named section separate from the arrangement even when its beat bounds coincide', async () => {
        keepDrumsOnly();
        const markers = markerStore.value;
        if (markers === null) {
            throw new Error('Missing sections.');
        }
        landProjectEdit(() =>
            markerStore.set({
                ...markers,
                sections: [{ id: 'entire', name: 'Entire named section', startBeat: 0, endBeat: 4, color: '#ffffff' }],
            })
        );
        const brief = await confirmBrief();
        const batch = requireOnlyProposedCard();
        const state = metricGoalStateCodec(batch.approvalSnapshot.metricGoalState);
        expect(measuredPlan(brief).initial.receipts).toHaveLength(2);
        expect(new Set(state?.proofs.map((proof) => proof.preview.range.sectionId))).toEqual(new Set([null, 'entire']));
        // One initial render holds both ranges; the preview renders live and the batch once each.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3);
    });

    it('refuses budget movement between initial chunks and retains its real failure receipt', async () => {
        useDrumKit();
        audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
            const run = readAgentRunState().runs.at(-1);
            if (run === undefined) {
                throw new Error('Missing run');
            }
            // The first unit reserved its four renders; competing work takes everything else.
            const left = readAgentResourceLimits().maxRenderJobs - ANALYSIS_MEASURE_MAX_TARGETS;
            expect(
                agentRunLifecycle.reserveBudgetBatch({
                    runId: run.runId,
                    attempts: [
                        {
                            attemptId: 'competing-work',
                            category: 'maxRenderJobs',
                            estimate: left,
                            provenance: 'versioned-estimate',
                        },
                    ],
                })
            ).toEqual({ status: 'reserved' });
            return renderTrack(input);
        });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const card = requireOnlyProposedCard();
        const run = agentRunLifecycle.get(card.runId);
        expect(run?.plan?.batchSchedule).toBeUndefined();
        expect(run?.plan?.applicationToolReceipts).toContainEqual(
            expect.objectContaining({
                status: 'failure',
                error: expect.objectContaining({ code: 'measurement-budget-exhausted' }),
            })
        );
        // The first unit rendered its four targets once; the second was refused before it rendered.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(ANALYSIS_MEASURE_MAX_TARGETS);
        expect(run?.workLeases.every((lease) => lease.terminalState !== null)).toBe(true);
        await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
        expect(trackStore.value?.tracks.every((track) => track.devices.length === 0)).toBe(true);
        expect(proposedCards()).toEqual([]);
    });

    it('refuses successful raw reads whose admitted receipt does not fit the verification-receipt allowance', async () => {
        keepDrumsOnly();
        verificationLimits.maxBytesPerCollection = 8_192;
        const markers = markerStore.value;
        const tracks = trackStore.value;
        if (markers === null || tracks === null) {
            throw new Error('Missing project.');
        }
        const targetId = `drums-${'d'.repeat(240)}`;
        landProjectEdit(() =>
            trackStore.set({
                ...tracks,
                tracks: tracks.tracks.map((track) => ({
                    ...track,
                    id: targetId,
                    clips: track.clips.map((clip) => ({ ...clip, trackId: targetId })),
                })),
            })
        );
        landProjectEdit(() =>
            markerStore.set({
                ...markers,
                sections: Array.from({ length: 20 }, (_, index) => ({
                    id: `section-${String(index)}-${'s'.repeat(230)}`,
                    name: `Section ${String(index)}`,
                    startBeat: index / 5,
                    endBeat: (index + 1) / 5,
                    color: '#ffffff',
                })),
            })
        );
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const card = requireOnlyProposedCard();
        const run = agentRunLifecycle.get(card.runId);
        expect(run?.plan?.batchSchedule).toBeUndefined();
        expect(cardContent(card)).toContain('receipt-budget-spent');
        expect(run?.plan?.applicationToolReceipts).toContainEqual(
            expect.objectContaining({
                status: 'failure',
                data: null,
                error: expect.objectContaining({ code: expect.stringMatching(/receipt-budget-spent/u) }),
            })
        );
        // The unit renders once for all 21 ranges; the allowance refuses at admission, after the reductions.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(run?.workLeases.every((lease) => lease.terminalState !== null)).toBe(true);
        await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
        expect(trackStore.value?.tracks.every((track) => track.devices.length === 0)).toBe(true);
        expect(proposedCards()).toEqual([]);
    });

    it.each(['timeout', 'render failure'] as const)(
        'settles an initial %s without scheduling a prefix',
        async (failure) => {
            keepDrumsOnly();
            agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, measurementWallClockMs: 10 });
            audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
                if (failure === 'render failure') {
                    throw new Error('Initial render failed.');
                }
                const signal = input.abortSignal;
                if (signal === undefined) {
                    throw new Error('Missing measurement deadline signal.');
                }
                if (!signal.aborted) {
                    await new Promise<void>((resolve) =>
                        signal.addEventListener('abort', () => resolve(), { once: true })
                    );
                }
                return renderTrack(input);
            });
            scriptPlanningTurns(BRIEF_ROUTE);
            await sendChatMessage(PROMPT);
            const card = requireOnlyProposedCard();
            const run = agentRunLifecycle.get(card.runId);
            expect(run?.plan?.batchSchedule).toBeUndefined();
            expect(run?.plan?.applicationToolReceipts).toContainEqual(
                expect.objectContaining({
                    status: 'failure',
                    error: expect.objectContaining({
                        code: failure === 'timeout' ? 'measurement-timed-out' : 'render-failed',
                    }),
                })
            );
            expect(run?.workLeases.every((lease) => lease.terminalState !== null)).toBe(true);
            expect(run?.budgets.consumed).toMatchObject({ maxRenderJobs: 1, localAnalysis: 0 });
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
            const receipts = structuredClone(run?.plan?.applicationToolReceipts);
            await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(liveBriefRevision()).toBe(PLANNED_BRIEF_REVISION);
            expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
            expect(agentRunLifecycle.get(card.runId)?.plan?.applicationToolReceipts).toEqual(receipts);
            await undo();
            expect(projectStore.value?.productionBrief.vision).toBeNull();
            expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        }
    );

    it('declining the measured brief changes no project or Undo state', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        const tracks = structuredClone(trackStore.value);
        const history = structuredClone(undoHistoryStore.value);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        await cancelPendingChatActions({ confirmationId: brief.id });
        expect(trackStore.value).toEqual(tracks);
        expect(undoHistoryStore.value).toEqual(history);
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
        // Planning rendered each of the three targets once, for every range.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3);
    });

    it('keeps protected truth and adds one global recipe chain whose single batch Undo removes it', async () => {
        const protectedVocal = structuredClone(trackStore.value?.tracks.find((track) => track.id === VOCAL_ID));
        scriptPlanningTurns([
            briefIntake,
            compileBrief,
            (request) =>
                proposeBrief(request).map((call) => {
                    if (!isRecord(call.arguments.plan)) {
                        throw new Error('Missing provider plan.');
                    }
                    return {
                        ...call,
                        arguments: {
                            ...call.arguments,
                            plan: {
                                ...call.arguments.plan,
                                scope: {
                                    targetIds: [],
                                    targetRanges: [],
                                    protectedTargetIds: [VOCAL_ID],
                                    protectedRanges: [],
                                },
                            },
                        },
                    };
                }),
        ]);
        await sendChatMessage('make this mix warmer and keep Vocal untouched');
        const brief = requireOnlyProposedCard();
        expect(measuredPlan(brief).batches.flatMap((batch) => batch.targetIds)).not.toContain(VOCAL_ID);
        expect(initialFigures(measuredPlan(brief)).some((figure) => figure.targetId === VOCAL_ID)).toBe(false);
        expect(
            audio.renderTrackSubgraphOffline.mock.calls.some(
                ([input]: [RenderInput]) => input.targetTrackId === VOCAL_ID
            )
        ).toBe(false);
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
        const drums = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({ status: 'executed' });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackStore.value?.tracks.find((track) => track.id === VOCAL_ID)).toEqual(protectedVocal);
        // Stop the next uncommitted batch before replaying the one committed group.
        await cancelPendingChatActions({ confirmationId: requireOnlyProposedCard().id });
        // The stopped card keeps its text; the run's summary follows it.
        expect(chatStore.value?.messages.at(-2)?.content).toContain('Batches 1–2 remain applied.');
        await undo();
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === VOCAL_ID)).toEqual(protectedVocal);
        expect(liveBriefRevision()).toBe(PLANNED_BRIEF_REVISION);
    });

    it('uses only the explicit arrangement range when the project has no sections', async () => {
        keepDrumsOnly();
        const markers = markerStore.value;
        if (markers === null) {
            throw new Error('Missing markers.');
        }
        landProjectEdit(() => markerStore.set({ ...markers, sections: [] }));
        const brief = await confirmBrief();
        const plan = measuredPlan(brief);
        expect(plan.initial.sections).toEqual([]);
        expect(plan.batches[0]?.verificationRanges).toEqual([{ startBeat: 0, endBeat: 4, sectionId: null }]);
        expect(plan.initial.receipts).toHaveLength(1);
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3);
    });

    it(
        'keeps processing eligible under an original control-only fader protection',
        async () => {
            useShortMeasuredSections();
            const gain = trackStore.value?.tracks.find((track) => track.id === VOCAL_ID)?.gain;
            const brief = await confirmBrief('make this mix warmer and keep Vocal fader unchanged');
            expect(measuredPlan(brief).batches.flatMap((batch) => batch.targetIds)).toContain(VOCAL_ID);
            expect(initialFigures(measuredPlan(brief)).filter((figure) => figure.targetId === VOCAL_ID)).toHaveLength(
                3
            );
            const drums = requireOnlyProposedCard();
            expectMeasuredBatch(drums, DRUMS_ID);
            await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
                status: 'executed',
            });
            const vocal = requireOnlyProposedCard();
            expectMeasuredBatch(vocal, VOCAL_ID);
            await expect(confirmPendingChatActions({ confirmationId: vocal.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(trackDeviceTypes(VOCAL_ID)).toEqual(['builtin-eq']);
            expect(trackStore.value?.tracks.find((track) => track.id === VOCAL_ID)?.gain).toBe(gain);
            // Three targets render once for every range, and each of the three batch previews twice.
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(9);
        },
        MULTI_BATCH_TEST_TIMEOUT_MS
    );

    it('refuses an unresolved original whole-object protection before any initial render', async () => {
        const revision = captureProjectRevision();
        const runId = 'unresolved-vibe-run';
        agentRunLifecycle.create({
            runId,
            request: 'make this mix warmer and keep the Ghost track untouched',
            mode: 'apply',
            createdRevision: revision,
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
        const run = agentRunLifecycle.get(runId);
        if (run === null) {
            throw new Error('Missing live run.');
        }
        const planned = await planVibeRunSchedule({
            prompt: run.request,
            context: getProjectContext(),
            brief: { ...seededBrief(), revision: PLANNED_BRIEF_REVISION },
            mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: ['warm'] },
            budgets: run.budgets,
            runId,
            sourceRevision: revision,
            signal: new AbortController().signal,
            admit: agentWorkBudget.admitMeasurement(runId),
            priorReceipts: [],
        });
        expect(planned.status).toBe('unscheduled');
        if (planned.status !== 'unscheduled') {
            throw new Error('Expected unresolved protection refusal.');
        }
        expect(planned.lines.join(' ')).toContain('unresolved original-request protection');
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('rechecks the remaining whole-run fit after the last successful initial read', async () => {
        keepDrumsOnly();
        // Exactly the run: one initial render of every range, then the batch preview's two.
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, maxRenderJobs: 3 });
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            // The initial render is the last initial read; competing work takes one render while it runs.
            if (audio.renderTrackSubgraphOffline.mock.calls.length === 1) {
                const run = readAgentRunState().runs.at(-1);
                if (run === undefined) {
                    throw new Error('Missing run.');
                }
                expect(
                    agentRunLifecycle.reserveBudgetBatch({
                        runId: run.runId,
                        attempts: [
                            {
                                attemptId: 'late-competing-work',
                                category: 'maxRenderJobs',
                                estimate: 1,
                                provenance: 'versioned-estimate',
                            },
                        ],
                    })
                ).toEqual({ status: 'reserved' });
            }
            return renderTrack(input);
        });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
        expect(cardContent(brief)).toContain('2 renders');
        expect(cardContent(brief)).toContain('1 this run');
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });

    it.each(['maxRenderJobs', 'localAnalysis'] as const)(
        'admits only the brief with no work left in %s',
        async (category) => {
            keepDrumsOnly();
            agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, [category]: 0 });
            scriptPlanningTurns(BRIEF_ROUTE);
            await sendChatMessage(PROMPT);
            const brief = requireOnlyProposedCard();
            expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
            expect(cardContent(brief)).toContain(category);
            expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
            expect(proposedCards()).toEqual([]);
        }
    );

    it('refuses the brief when no command budget remains', async () => {
        keepDrumsOnly();
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, maxCommands: 0 });
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        expect(proposedCards()).toEqual([]);
        expect(chatStore.value?.messages.at(-1)?.error).toContain('maxCommands');
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
    });
});
