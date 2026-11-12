import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, runtimeGraphTopology, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { planPromptActions } from '../planPromptActions';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    AMBIGUOUS_SAME_OBJECT_DIVERGENCE_REASON,
    ambiguousSameObjectDivergence,
    ambiguousSameObjectDivergenceMessage,
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    isRecord,
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';
import { literalMetricIntakeTurn, metricGoalProviderPlan, readMetricPublication } from './metricGoalWorkflowFixture';
import { decodeReceiptContext, readReceiptSummary } from './receiptContextFixture';

registerDeviceEnginePorts();

/**
 * AC-002 of #4372 retired the hardcoded whole-project vibe-mix workflow: a project shaped like its
 * fixture (a second chorus, one drum bus, one bass bus, a lead vocal and one master) once offered
 * the provider a fixed `automateTrackGainRange` lift of those buses and a "Whole-project plan"
 * card block. Such a project now plans like any other, through general perceptual planning.
 */
const VIBE_PROMPT = 'Make the second chorus hit harder.';
// General planning edits only what a request names or selects, so the planned vibe request names
// the bus it wants to hit harder.
const NAMED_VIBE_PROMPT = 'Make the Drum Bus hit harder in the second chorus.';
const PROTECTED_VIBE_PROMPT = 'Make the Drum Bus hit harder in the second chorus and keep the lead vocal untouched.';
const LITERAL_PROMPT = 'Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two';
const IMPACT_BUS_IDS = ['bus-drums', 'bus-bass'] as const;
const DRUM_BUS_ID = 'bus-drums';
const CHORUS_TWO = { startBeat: 56, endBeat: 72 } as const;
const RETIRED_CAPABILITY_ID = 'whole-project-vibe-mix';

const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'webllm' } }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted provider planning request.');
    }),
}));

type ProviderRequest = { userMessage: string; schemas: readonly ToolSchema[] };
type ScriptedPlanningTurn = (request: ProviderRequest) => ToolCallResult[];

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function getProviderSection(userMessage: string, section: string): Record<string, unknown> {
    const match = new RegExp(String.raw`^${section}:\n(?<payload>.+)$`, 'mu').exec(userMessage);
    const payload = match?.groups?.payload;
    if (!payload) {
        throw new TypeError(`Expected ${section} in provider request`);
    }
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed)) {
        throw new TypeError(`Expected object-shaped ${section}`);
    }
    return parsed;
}

/** The application capabilities the provider request actually serialized. */
function getAdvertisedCapabilities(userMessage: string): Record<string, unknown> {
    const schemas = getProviderSection(userMessage, 'capability_schemas');
    if (typeof schemas.availableCapabilities !== 'string') {
        throw new TypeError('Expected serialized available capabilities in provider request');
    }
    const capabilities: unknown = JSON.parse(schemas.availableCapabilities);
    if (!isRecord(capabilities)) {
        throw new TypeError('Expected object-shaped available capabilities');
    }
    return capabilities;
}

/** Records every outbound planning request and answers it with the next scripted turn. */
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

function findSchema(schemas: readonly ToolSchema[], name: string): ToolSchema {
    const schema = schemas.find((candidate) => candidate.function.name === name);
    if (schema === undefined) {
        throw new TypeError(`Expected the published ${name} schema`);
    }
    return schema;
}

/**
 * The general perceptual intake: the provider edits the named bus's processing with a new device
 * and declares impact a perceptual objective the application cannot measure, every id read from
 * the catalog the run published.
 */
function perceptualImpactIntake({ userMessage, schemas }: ProviderRequest): ToolCallResult[] {
    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
    const base = selectCreativeInterpretationCall({
        catalog,
        modeId: 'edit',
        targetObjectIds: [DRUM_BUS_ID],
        dimensions: ['processing'],
        creationSlotObjectTypes: ['device'],
    });
    const schema = findSchema(schemas, base.name);
    const objective = readMetricPublication(schema).find((candidate) => candidate.kind === 'unsupported');
    if (objective === undefined) {
        throw new TypeError('Expected the published unsupported impact objective');
    }
    const call = {
        ...base,
        id: 'impact-intake',
        arguments: {
            ...base.arguments,
            answer: null,
            metricIntent: {
                kind: 'perceptual',
                uncertainty: 'none',
                objectives: [
                    {
                        objectiveId: objective.id,
                        scopeCandidateId: null,
                        referenceScopeCandidateId: null,
                        rangeCandidateId: null,
                    },
                ],
            },
        },
    };
    expect(matchesJsonSchema(call.arguments, schema.function.parameters)).toBe(true);
    return [call];
}

const discoverAndMeasure: ScriptedPlanningTurn = () => [
    {
        id: 'discover-punch',
        name: 'recipe.discover',
        arguments: { descriptors: ['punchy'], targetId: DRUM_BUS_ID, limit: 1 },
    },
    {
        id: 'impact-baseline',
        name: 'analysis.measure',
        arguments: { scope: { kind: 'buses', ids: [DRUM_BUS_ID] }, range: { ...CHORUS_TWO } },
    },
];

/** The first candidate the discovery receipt actually returned, never a recipe id the script assumes. */
function readDiscoveredRecipeId(userMessage: string): string {
    const discovery = decodeReceiptContext(readReceiptSummary(userMessage).value).find(
        (receipt) => isRecord(receipt) && receipt.callId === 'discover-punch'
    );
    const candidates = isRecord(discovery) && isRecord(discovery.data) ? discovery.data.candidates : undefined;
    const first: unknown = Array.isArray(candidates) ? candidates[0] : undefined;
    if (!isRecord(first) || typeof first.id !== 'string') {
        throw new TypeError('Expected a discovered punchy recipe for the Drum Bus');
    }
    return first.id;
}

const expandPunchyRecipe: ScriptedPlanningTurn = ({ userMessage }) => [
    {
        id: 'expand-punch',
        name: 'recipe.expand',
        arguments: { recipeId: readDiscoveredRecipeId(userMessage), targetId: DRUM_BUS_ID },
    },
];

const proposeExpandedRecipe: ScriptedPlanningTurn = () => [
    {
        id: 'impact-proposal',
        name: 'command.batch.propose',
        arguments: {
            commands: [],
            compiledCallIds: ['expand-punch'],
            plan: metricGoalProviderPlan('Give the Drum Bus more punch.', [DRUM_BUS_ID]),
        },
    },
];

const GENERAL_PERCEPTUAL_ROUTE: readonly ScriptedPlanningTurn[] = [
    perceptualImpactIntake,
    discoverAndMeasure,
    expandPunchyRecipe,
    proposeExpandedRecipe,
];

/** A provider that cannot tell which tracks an unnamed vibe request means asks instead. */
const askWhichTracks: ScriptedPlanningTurn = () => [
    {
        id: 'which-tracks',
        name: 'command.batch.decline',
        arguments: { kind: 'clarify', reason: 'The request names no track.', questions: ['Which tracks?'] },
    },
];

const literalIntake: ScriptedPlanningTurn = ({ userMessage, schemas }) =>
    literalMetricIntakeTurn(userMessage, schemas).map((call) => ({ ...call, id: 'literal-intake' }));

const discoverGainRange: ScriptedPlanningTurn = () => [
    {
        id: 'gain-range-schema',
        name: 'agent.catalog.discover',
        arguments: { category: 'command', names: ['automateParameterRange'] },
    },
];

/** One section-wide gain lift per bus: the fader steps up by the stated decibels over the section. */
function gainLift(trackId: (typeof IMPACT_BUS_IDS)[number]) {
    return {
        name: 'automateParameterRange',
        arguments: { trackId, parameterId: 'gain', range: { section: 'Chorus Two' }, deltaDb: 1.5 },
    };
}

const proposeNamedGainRange: ScriptedPlanningTurn = () => [
    {
        id: 'gain-range-proposal',
        name: 'command.batch.propose',
        arguments: {
            commands: IMPACT_BUS_IDS.map(gainLift),
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Lift the Drum Bus and Bass Bus by 1.5 dB in Chorus Two.',
                constraints: [],
                scope: {
                    targetIds: [...IMPACT_BUS_IDS],
                    targetRanges: [CHORUS_TWO],
                    protectedTargetIds: [],
                    protectedRanges: [],
                },
                capabilityIds: ['automateParameterRange'],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Validate the named buses, the section and the stated gain.'],
                stoppingConditions: ['Stop if the revision, the section or a bus changes.'],
            },
        },
    },
];

function expectNoRetiredCapability(requests: readonly ProviderRequest[]): void {
    expect(requests.length).toBeGreaterThan(0);
    for (const { userMessage, schemas } of requests) {
        expect(getAdvertisedCapabilities(userMessage)).not.toHaveProperty('wholeProjectVibeMixCapability');
        expect(userMessage).not.toContain(RETIRED_CAPABILITY_ID);
        const selector = schemas.find((schema) => schema.function.name === 'selectWorkflowCapability');
        if (selector !== undefined) {
            expect(JSON.stringify(selector)).not.toContain(RETIRED_CAPABILITY_ID);
            expect(matchesJsonSchema({ capabilityId: RETIRED_CAPABILITY_ID }, selector.function.parameters)).toBe(
                false
            );
        }
    }
}

function createTrack(id: string, name: string, kind: Track['kind']): Track {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
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

async function sendChatMessage(prompt: string): Promise<void> {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt);
}

function admitProviderAttempt() {
    return { status: 'admitted' as const };
}

function getPendingProposal() {
    const message = chatStore.value?.messages.find((candidate) => candidate.pendingActionConfirmationId);
    const confirmation = getPendingActionConfirmation(message?.pendingActionConfirmationId ?? '');
    if (message === undefined || !confirmation) {
        const last = chatStore.value?.messages.at(-1);
        throw new TypeError(`Expected one pending proposal: ${last?.error ?? last?.content ?? 'no reply'}`);
    }
    return { message, confirmation };
}

function getGainLanes() {
    return automationStore.value?.lanes.filter((lane) => lane.parameterId === 'gain') ?? [];
}

/**
 * The section gain trajectory the literal lift commits on each bus: an instant step up at the start
 * of Chorus Two, held, and an instant step back at its end, each step two points on one beat.
 */
function expectExactGainAutomation(): void {
    const liftedGain = 0.8 * 10 ** (1.5 / 20);
    const point = (beat: number, value: number) => ({
        id: expect.any(String),
        beat,
        value,
        curve: 'linear',
        tension: 0,
    });
    const trajectory = [
        point(CHORUS_TWO.startBeat, 0.8),
        point(CHORUS_TWO.startBeat, liftedGain),
        point(CHORUS_TWO.endBeat, liftedGain),
        point(CHORUS_TWO.endBeat, 0.8),
    ];
    expect(getGainLanes()).toEqual(
        IMPACT_BUS_IDS.map((trackId) =>
            expect.objectContaining({ trackId, parameterId: 'gain', parameterName: 'Gain', points: trajectory })
        )
    );
}

/**
 * The lift's undo entries: one range write per bus. The public undo store shows entries by label
 * only, so their grouping is observed by each case's single `undo()` or `redo()` moving all of them.
 */
function expectOneLiftGroup(entries: NonNullable<typeof undoStore.value>['past'] | undefined): void {
    expect(entries).toHaveLength(IMPACT_BUS_IDS.length);
}

/** Plans the literal lift through the chat and returns the card it waits on. */
async function proposeLiteralLift() {
    scriptPlanningTurns([literalIntake, discoverGainRange, proposeNamedGainRange]);
    await sendChatMessage(LITERAL_PROMPT);
    return getPendingProposal().confirmation;
}

function snapshotProject() {
    return {
        tracks: structuredClone(trackStore.value),
        automation: structuredClone(automationStore.value),
        undo: structuredClone(undoStore.value),
        revision: captureProjectRevision(),
    };
}

describe('retired whole-project vibe-mix workflow (AC-002 of #4372)', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.mocked(generateToolPlanningOutcome).mockReset();
        runtimeMocks.backend.value = 'webllm';
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('retired whole-project vibe-mix test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        // The exact shape the retired scope admitted: a second chorus, one drum bus, one bass bus,
        // a lead vocal holding a locked clip, and one master.
        const drumBus = createTrack('bus-drums', 'Drum Bus', 'bus');
        const bassBus = createTrack('bus-bass', 'Bass Bus', 'bus');
        const leadVocal = createTrack('track-lead-vocal', 'Lead Vocal', 'audio');
        leadVocal.clips = [
            {
                id: 'clip-locked-lead-vocal',
                trackId: leadVocal.id,
                name: 'Locked Lead Vocal Comp',
                startBeat: 0,
                endBeat: 80,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ffffff',
                locked: true,
                muted: false,
            },
        ];
        const backingVocal = createTrack('track-backing-vocal', 'Backing Vocal', 'audio');
        const master = createTrack('track-master', 'Master', 'master');
        landProjectEdit(() => {
            trackStore.set({
                tracks: [drumBus, bassBus, leadVocal, backingVocal, master],
                selectedTrackId: null,
                ghostClips: [],
            });
            markerStore.set({
                markers: [],
                sections: [
                    { id: 'section-verse-two', name: 'Verse Two', startBeat: 16, endBeat: 32, color: '#ffffff' },
                    { id: 'section-chorus-one', name: 'Chorus One', startBeat: 32, endBeat: 48, color: '#ffffff' },
                    { id: 'section-bridge', name: 'Bridge', startBeat: 48, endBeat: 56, color: '#ffffff' },
                    { id: 'section-chorus-two', name: 'Chorus Two', ...CHORUS_TWO, color: '#ffffff' },
                    { id: 'section-outro', name: 'Outro', startBeat: 72, endBeat: 80, color: '#ffffff' },
                ],
            });
            automationStore.set({ lanes: [] });
            transportStore.set({
                ...defaultTransportState,
                tempo: 124,
                timeSignatureNumerator: 4,
                timeSignatureDenominator: 4,
            });
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('offers the provider no whole-project vibe-mix capability on a vibe-shaped project', async () => {
        // Clarification is admitted or refused by the application; either way every turn asks again.
        const requests = scriptPlanningTurns(Array.from({ length: 16 }, () => askWhichTracks));

        const { result } = await planPromptActions({ prompt: VIBE_PROMPT, onProviderAttempt: admitProviderAttempt });

        expectNoRetiredCapability(requests);
        expect(requests[0]?.schemas.map((schema) => schema.function.name)).toContain('selectCreativeInterpretation');
        expect(result.actions).toEqual([]);
    });

    it('plans a vibe request through discovery, measurement and recipe expansion into a plain recipe proposal', async () => {
        const requests = scriptPlanningTurns(GENERAL_PERCEPTUAL_ROUTE);
        const before = snapshotProject();

        await sendChatMessage(NAMED_VIBE_PROMPT);

        const { message, confirmation } = getPendingProposal();
        expectNoRetiredCapability(requests);
        expect(requests).toHaveLength(GENERAL_PERCEPTUAL_ROUTE.length);
        expect(confirmation.status).toBe('proposed');
        expect(confirmation.actions.length).toBeGreaterThan(0);
        expect(new Set(confirmation.actions.map((action) => action.type))).toEqual(
            new Set(['addDevice', 'setDeviceParameter'])
        );
        expect(
            confirmation.actions.flatMap((action) => (action.type === 'addDevice' ? [action.payload.trackId] : []))
        ).toEqual([DRUM_BUS_ID]);
        expect(confirmation.approvalSnapshot.adoptedRecipes).toEqual([
            expect.objectContaining({
                recipeId: readDiscoveredRecipeId(requests[2]?.userMessage ?? ''),
                targetId: DRUM_BUS_ID,
            }),
        ]);
        expect(message.content).toContain('This prompt requires confirmation before execution.');
        expect(message.content).not.toContain('Whole-project plan');
        expect(message.content).not.toContain('Production vision');
        expect(confirmation.protectedUnchanged.map((object) => object.id)).not.toContain('track-lead-vocal');
        expect(confirmation.protectedUnchanged.map((object) => object.id)).not.toContain('project:tempo-map');
        expect(snapshotProject()).toEqual(before);
    });

    it('still grounds a literal bus gain lift by name through the ordinary target rule', async () => {
        const requests = scriptPlanningTurns([literalIntake, discoverGainRange, proposeNamedGainRange]);
        const before = snapshotProject();

        const { result } = await planPromptActions({ prompt: LITERAL_PROMPT, onProviderAttempt: admitProviderAttempt });

        expectNoRetiredCapability(requests);
        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual(
            IMPACT_BUS_IDS.map((trackId) =>
                expect.objectContaining({
                    type: 'automateParameterRange',
                    payload: expect.objectContaining({
                        trackId,
                        parameterId: 'gain',
                        range: { section: 'Chorus Two' },
                        deltaDb: 1.5,
                        ...CHORUS_TWO,
                    }),
                })
            )
        );
        expect(result).not.toHaveProperty('wholeProjectVibeMixPlan');
        expect(snapshotProject()).toEqual(before);
    });

    // The legacy gain-lift tool stays executable for stored batches only: a provider that asks for it
    // is answered as for any command it was never offered, and nothing it names runs.
    it('refuses a provider that names the retired gain-lift tool and runs none of it', async () => {
        const discoverRetired: ScriptedPlanningTurn = () => [
            {
                id: 'retired-schema',
                name: 'agent.catalog.discover',
                arguments: { category: 'command', names: ['automateTrackGainRange'] },
            },
        ];
        const proposeRetired: ScriptedPlanningTurn = () => [
            {
                id: 'retired-proposal',
                name: 'command.batch.propose',
                arguments: {
                    commands: [
                        {
                            name: 'automateTrackGainRange',
                            arguments: { trackIds: [...IMPACT_BUS_IDS], sectionName: 'Chorus Two', gainDb: 1.5 },
                        },
                    ],
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: 'Lift the Drum Bus and Bass Bus by 1.5 dB in Chorus Two.',
                        constraints: [],
                        scope: {
                            targetIds: [...IMPACT_BUS_IDS],
                            targetRanges: [CHORUS_TWO],
                            protectedTargetIds: [],
                            protectedRanges: [],
                        },
                        capabilityIds: ['automateTrackGainRange'],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: ['Validate the named buses, the section and the stated gain.'],
                        stoppingConditions: ['Stop if the revision, the section or a bus changes.'],
                    },
                },
            },
        ];
        const requests = scriptPlanningTurns([
            literalIntake,
            discoverRetired,
            proposeRetired,
            ...Array.from({ length: 6 }, () => askWhichTracks),
        ]);
        const before = snapshotProject();

        await sendChatMessage(LITERAL_PROMPT);

        const discovery = decodeReceiptContext(readReceiptSummary(requests[2]?.userMessage ?? '').value).find(
            (receipt) => isRecord(receipt) && receipt.callId === 'retired-schema'
        );
        expect(discovery).toMatchObject({
            status: 'failure',
            data: null,
            error: { code: 'invalid-tool-arguments' },
        });
        expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId !== undefined)).toBe(
            false
        );
        expect(getGainLanes()).toEqual([]);
        expect(snapshotProject()).toEqual(before);
    });

    it('protects the lead vocal only when the request says so, through the explicit-protection reader', async () => {
        const requests = scriptPlanningTurns(GENERAL_PERCEPTUAL_ROUTE);

        await sendChatMessage(PROTECTED_VIBE_PROMPT);

        const { message, confirmation } = getPendingProposal();
        expectNoRetiredCapability(requests);
        expect(confirmation.protectedUnchanged).toContainEqual({ id: 'track-lead-vocal', name: 'Lead Vocal' });
        expect(confirmation.actions.some((action) => JSON.stringify(action).includes('track-lead-vocal'))).toBe(false);
        expect(message.content).toContain('Protected unchanged: "Lead Vocal" (track-lead-vocal)');
        expect(message.content).not.toContain('Whole-project plan');
    });

    // The retired workflow's commit-path pins, carried to the literal route that now reaches the command.
    describe('literal gain lift commit path', () => {
        it('confirms, atomically commits, receipts, and whole-group undoes and redoes only the section gain trajectory', async () => {
            const tracksBefore = structuredClone(trackStore.value?.tracks);
            const sectionsBefore = structuredClone(markerStore.value?.sections);
            const transportBefore = structuredClone(transportStore.value);

            const confirmation = await proposeLiteralLift();

            expect(confirmation.executionMode).toBe('atomic');
            // Two bounded-reversible range writes across two buses: the risk policy's multi-target class.
            expect(confirmation.risk?.level).toBe('broad-reversible');
            // A range write names the tracks it writes; the section only places the range.
            expect(confirmation.affectedIds).toEqual(['bus-drums', 'bus-bass']);
            expect(confirmation.actions).toEqual(
                IMPACT_BUS_IDS.map((trackId) => ({
                    type: 'automateParameterRange',
                    payload: {
                        trackId,
                        parameterId: 'gain',
                        range: { section: 'Chorus Two' },
                        deltaDb: 1.5,
                        ...CHORUS_TWO,
                    },
                }))
            );

            const revisionBefore = captureProjectRevision();
            await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
                status: 'executed',
            });

            expect(captureProjectRevision()).not.toBe(revisionBefore);
            expectExactGainAutomation();
            const drumLane = getGainLanes().find((lane) => lane.trackId === 'bus-drums');
            if (!drumLane) {
                throw new Error('Expected the committed Drum Bus gain lane');
            }
            expect(getAutomationValueAtBeat(drumLane.id, 55.999)).toBe(0.8);
            expect(getAutomationValueAtBeat(drumLane.id, 56)).toBe(0.8 * 10 ** (1.5 / 20));
            expect(getAutomationValueAtBeat(drumLane.id, 71.999)).toBe(0.8 * 10 ** (1.5 / 20));
            expect(getAutomationValueAtBeat(drumLane.id, 72)).toBe(0.8);
            expect(trackStore.value?.tracks).toEqual(tracksBefore);
            expect(markerStore.value?.sections).toEqual(sectionsBefore);
            expect(transportStore.value).toEqual(transportBefore);
            const receipt = chatStore.value?.messages.find(
                (message) => message.pendingActionConfirmationId === confirmation.id
            );
            expect(receipt?.content).toContain('Outcome: committed');
            for (const busId of IMPACT_BUS_IDS) {
                expect(receipt?.content).toContain(`- Affected IDs: ${busId}\n  - Outcome: committed`);
            }
            expectOneLiftGroup(undoStore.value?.past);

            await undo();
            expect(getGainLanes()).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
            expectOneLiftGroup(undoStore.value?.future);

            await redo();
            expectExactGainAutomation();
            expect(undoStore.value?.future).toEqual([]);
            expectOneLiftGroup(undoStore.value?.past);
        });

        // The edit below changes automation mode for a target this plan names, and the refusal names
        // that target: the divergence port classifies the conflict rather than reporting a bare move.
        it('leaves no partial lanes or receipt when the project changes before confirmation', async () => {
            const confirmation = await proposeLiteralLift();
            landProjectEdit(() => {
                trackStore.set({
                    ...trackStore.value!,
                    tracks: trackStore.value!.tracks.map((track) =>
                        track.id === 'bus-bass' ? { ...track, automationMode: 'off' } : track
                    ),
                });
            });

            const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

            expect(result).toEqual({
                status: 'invalidated',
                reason: AMBIGUOUS_SAME_OBJECT_DIVERGENCE_REASON,
                divergence: ambiguousSameObjectDivergence(['bus-bass']),
            });
            expect(getGainLanes()).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
            expect(getPendingActionConfirmation(confirmation.id)).toMatchObject({
                status: 'invalidated',
                executedActions: [],
            });
            const terminalMessage = chatStore.value?.messages.find(
                (message) => message.pendingActionConfirmationId === confirmation.id
            );
            expect(terminalMessage?.content).toBe(ambiguousSameObjectDivergenceMessage(['bus-bass']));
        });

        it('aborts a failed atomic store write without lane, receipt, or undo residue', async () => {
            const confirmation = await proposeLiteralLift();
            const originalSet = automationStore.set.bind(automationStore);
            vi.spyOn(automationStore, 'set').mockImplementationOnce((state) => {
                originalSet(state);
                throw new Error('injected gain-lift persistence failure');
            });

            const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

            expect(result).toEqual({ status: 'failed', reason: 'injected gain-lift persistence failure' });
            expect(getGainLanes()).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
            const terminalMessage = chatStore.value?.messages.find(
                (message) => message.pendingActionConfirmationId === confirmation.id
            );
            expect(terminalMessage?.content).not.toContain('Outcome: committed');
        });

        it('preserves collaborator lane edits and keeps the whole undo group retryable', async () => {
            const confirmation = await proposeLiteralLift();
            await confirmPendingChatActions({ confirmationId: confirmation.id });
            const committed = structuredClone(automationStore.value);
            const drumLane = getGainLanes().find((lane) => lane.trackId === 'bus-drums');
            if (!drumLane) {
                throw new Error('Expected Drum Bus gain automation lane');
            }
            automationStore.set({
                lanes: automationStore.value!.lanes.map((lane) => {
                    if (lane.id !== drumLane.id) {
                        return lane;
                    }
                    return {
                        ...lane,
                        points: lane.points.map((point, index) =>
                            index === 1 ? { ...point, value: point.value - 0.01 } : point
                        ),
                    };
                }),
            });
            const collaboratorState = structuredClone(automationStore.value);
            const pastBeforeConflict = structuredClone(undoStore.value?.past);
            await undo();

            expect(automationStore.value).toEqual(collaboratorState);
            expect(undoStore.value?.past).toEqual(pastBeforeConflict);
            expect(undoStore.value?.future).toEqual([]);

            // Once the collaborator edit is undone back to the committed state,
            // the same grouped undo applies: retryability survives the divergence.
            automationStore.set(committed);
            await undo();
            expect(getGainLanes()).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
            expectOneLiftGroup(undoStore.value?.future);
        });
    });
});
