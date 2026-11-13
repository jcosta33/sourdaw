import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getProjectHandlers, setTrackCanonicalRole } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { executeBriefCompile } from '../executeBriefCompile';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    isRecord,
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
} from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';
import {
    literalMetricIntakeTurn,
    metricGoalAudioBuffer,
    provideMetricGoalWindowBuffers,
} from './metricGoalWorkflowFixture';
import { decodeReceiptContext, readReceiptSummary } from './receiptContextFixture';

registerDeviceEnginePorts();

/**
 * AC-001 of #4372: a whole-project request writes the production brief. The provider interprets it
 * as a brief request, composes the update through `brief.compile`, and proposes that compilation
 * alone; the user confirms one `setProductionBrief` card.
 */
const VIBE_PROMPT = 'Make this record feel like a rainy late-night drive.';
const CONSTRAINED_VIBE_PROMPT = 'make this a late-night record but keep the vocal intimate';
const LITERAL_PROMPT = 'turn the vocal down 2 dB';
const VISION = 'A rainy late-night drive';

const VOCAL_ID = 'vocal';
const DRUMS_ID = 'track-drums';
const KEYS_ID = 'track-keys';
const CHORUS_ID = 'section-chorus';

const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));

// Only a planned vibe-run batch renders here, for its measured preview; no other row reaches a render.
const audio = vi.hoisted(() => ({ renderTrackSubgraphOffline: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

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

type ProviderRequest = { userMessage: string; schemas: readonly ToolSchema[] };
type ScriptedPlanningTurn = (request: ProviderRequest) => ToolCallResult[];
type ProductionBrief = NonNullable<typeof projectStore.value>['productionBrief'];
/** A track as the track store holds it, read from the store contract rather than Arrangement's model. */
type StoredTrack = NonNullable<typeof trackStore.value>['tracks'][number];

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

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

/** The brief interpretation: no target, dimension, constraint or slot, and no acoustic claim. */
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

const literalIntake: ScriptedPlanningTurn = ({ userMessage, schemas }) =>
    literalMetricIntakeTurn(userMessage, schemas).map((call) => ({ ...call, id: 'literal-intake' }));

function compileBrief(update: Record<string, unknown>, requestedDescriptors: readonly string[]): ScriptedPlanningTurn {
    return () => [
        {
            id: 'brief-compile',
            name: 'brief.compile',
            arguments: {
                ...update,
                mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors },
            },
        },
    ];
}

const VIBE_UPDATE = {
    vision: VISION,
    references: [{ label: 'Rainy tape demo' }],
    preferences: [{ trackId: KEYS_ID, statement: 'Dusty and soft' }],
    sectionGoals: [{ sectionId: CHORUS_ID, statement: 'Open up a little' }],
    trackRoles: [{ trackId: KEYS_ID, role: 'keys' }],
};

const BRIEF_PLAN = {
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Record the project intent the request describes.',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: ['Compare the brief revision before writing.'],
    stoppingConditions: ['Stop if the brief changes before Confirm.'],
};

function proposeCompiled(commands: readonly Record<string, unknown>[] = []): ScriptedPlanningTurn {
    return () => [
        {
            id: 'brief-proposal',
            name: 'command.batch.propose',
            arguments: { commands: [...commands], compiledCallIds: ['brief-compile'], plan: BRIEF_PLAN },
        },
    ];
}

const decline: ScriptedPlanningTurn = () => [
    {
        id: 'decline',
        name: 'command.batch.decline',
        arguments: { kind: 'clarify', reason: 'Nothing left to propose.', questions: ['What next?'] },
    },
];

const BRIEF_ROUTE = [briefIntake, compileBrief(VIBE_UPDATE, []), proposeCompiled()];

function readReceipt(userMessage: string, callId: string): Record<string, unknown> {
    const receipt = decodeReceiptContext(readReceiptSummary(userMessage).value).find(
        (candidate) => isRecord(candidate) && candidate.callId === callId
    );
    if (!isRecord(receipt)) {
        throw new TypeError(`Expected the ${callId} receipt in the provider request`);
    }
    return receipt;
}

function createTrack(id: string, name: string): StoredTrack {
    return {
        id,
        name,
        kind: 'audio',
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

function seededBrief(): ProductionBrief {
    return {
        schemaVersion: 1,
        id: 'production-brief',
        revision: 4,
        vision: null,
        references: [],
        hardConstraints: [],
        preferences: [],
        sectionGoals: [],
        trackRoles: [{ id: 'role-drums', trackId: DRUMS_ID, role: 'drums', createdAt: 100 }],
        locks: [{ id: 'lock-drums', scope: { kind: 'track', trackId: DRUMS_ID }, statement: 'Drums', createdAt: 100 }],
        decisions: [
            {
                id: 'decision-tempo',
                scope: { kind: 'project' },
                statement: 'Keep the tempo',
                rationale: null,
                status: 'accepted',
                sourceRunId: null,
                relatedBatchId: null,
                supersededByDecisionId: null,
                createdAt: 100,
            },
        ],
        unresolvedQuestions: [],
        sourceRunLinks: [],
        supersedesBriefId: null,
        supersededByBriefId: null,
        createdAt: 100,
        updatedAt: 100,
    };
}

type RenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];

function audioClip(trackId: string): StoredTrack['clips'][number] {
    return {
        id: `${trackId}-clip`,
        trackId,
        name: 'Take',
        type: 'audio',
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

/** A 100 Hz body and a 3 kHz top, each scaled by the low and high shelves of the track's EQs. */
function renderShelvedTone(input: RenderInput): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const parameter = (id: string) =>
        track.devices.reduce((total, device) => total + (device.parameterValues[id] ?? 0), 0);
    const low = 10 ** (parameter('eq-low-gain') / 20);
    const high = 10 ** (parameter('eq-high-gain') / 20);
    // The spec's project runs at 90 bpm.
    const seconds = ((input.endBeat - input.startBeat) * 60) / 90;
    return metricGoalAudioBuffer(
        (time) => 0.4 * low * Math.sin(2 * Math.PI * 100 * time) + 0.2 * high * Math.sin(2 * Math.PI * 3000 * time),
        seconds
    );
}

function readBrief(): ProductionBrief {
    const brief = projectStore.value?.productionBrief;
    if (brief === undefined) {
        throw new TypeError('Expected an open project with a brief');
    }
    return structuredClone(brief);
}

async function sendChatMessage(prompt: string, options?: Parameters<typeof sendChatMessageWithoutDocumentFlush>[1]) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt, options);
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

function countCards(): number {
    return pendingActionConfirmationStore.value?.confirmations.length ?? 0;
}

describe('writing the production brief from a whole-project request (AC-001 of #4372)', () => {
    beforeEach(() => {
        provideMetricGoalWindowBuffers();
        configureAiWorkflowCommandPreflightFixture();
        vi.mocked(generateToolPlanningOutcome).mockReset();
        audio.renderTrackSubgraphOffline.mockReset();
        runtimeMocks.backend.value = 'cloud';
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('brief from request test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        registerHandlerMap(getProjectHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        landProjectEdit(() => {
            trackStore.set({
                tracks: [createTrack(VOCAL_ID, 'Vocal'), createTrack(DRUMS_ID, 'Drums'), createTrack(KEYS_ID, 'Keys')],
                selectedTrackId: null,
                ghostClips: [],
            });
            markerStore.set({
                markers: [],
                sections: [
                    { id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16, color: '#ffffff' },
                    { id: CHORUS_ID, name: 'Chorus', startBeat: 16, endBeat: 32, color: '#ffffff' },
                ],
            });
            automationStore.set({ lanes: [] });
            transportStore.set({ ...defaultTransportState, tempo: 90 });
            projectStore.set({ ...structuredClone(defaultProjectStoreState), productionBrief: seededBrief() });
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
        agentRunLifecycle.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('turns a vibe request into one brief card listing what it adds', async () => {
        const requests = scriptPlanningTurns(BRIEF_ROUTE);
        const before = readBrief();

        await sendChatMessage(VIBE_PROMPT);

        const { confirmation } = getPendingProposal();
        expect(requests).toHaveLength(BRIEF_ROUTE.length);
        expect(requests[0]?.schemas.map((schema) => schema.function.name)).toContain('brief.compile');
        expect(confirmation.status).toBe('proposed');
        expect(confirmation.actions.map((action) => action.type)).toEqual(['setProductionBrief']);
        expect(confirmation.actions[0]).toMatchObject({
            payload: { expectedRevision: before.revision, brief: { revision: before.revision + 1, vision: VISION } },
        });
        expect(confirmation.actionLabels).toEqual([
            expect.stringContaining(`Update the production brief from revision ${String(before.revision)}:`),
        ]);
        expect(confirmation.actionLabels[0]).toContain(`Vision: ${VISION}`);
        expect(confirmation.actionLabels[0]).toContain('Preference (Keys): Dusty and soft');
        expect(confirmation.actionLabels[0]).toContain('Chorus goal: Open up a little');
        expect(confirmation.actionLabels[0]).toContain('Role: Keys is the keys');
        expect(readBrief()).toEqual(before);
    });

    it('writes the next revision on Confirm with locks and decisions unchanged, and undo restores it', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        const before = readBrief();
        await sendChatMessage(VIBE_PROMPT);
        const { confirmation } = getPendingProposal();

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        const after = readBrief();
        expect(after.revision).toBe(before.revision + 1);
        expect(after.vision).toBe(VISION);
        expect(JSON.stringify(after.locks)).toBe(JSON.stringify(before.locks));
        expect(JSON.stringify(after.decisions)).toBe(JSON.stringify(before.decisions));
        expect(after.trackRoles).toEqual([
            ...before.trackRoles,
            expect.objectContaining({ trackId: KEYS_ID, role: 'keys' }),
        ]);
        expect(after.sourceRunLinks).toEqual([expect.objectContaining({ sourceRunId: confirmation.runId })]);
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('completed');

        await undo();

        // A brief's undo writes the earlier content as a later revision, so a stale writer still
        // holding the confirmed revision is refused rather than overwriting the restored brief.
        const restored = readBrief();
        expect(restored.revision).toBeGreaterThan(after.revision);
        expect({ ...restored, revision: before.revision }).toEqual(before);
    });

    it('leaves the brief unchanged on Reject, cancels the run and proposes nothing further', async () => {
        const requests = scriptPlanningTurns(BRIEF_ROUTE);
        const before = readBrief();
        await sendChatMessage(VIBE_PROMPT);
        const { confirmation } = getPendingProposal();

        await expect(cancelPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'cancelled',
        });

        expect(readBrief()).toEqual(before);
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('cancelled');
        expect(getPendingActionConfirmation(confirmation.id)?.status).toBe('cancelled');
        expect(countCards()).toBe(1);
        expect(requests).toHaveLength(BRIEF_ROUTE.length);
    });

    it('answers brief.compile on a literal request with brief-not-requested and writes nothing', async () => {
        const requests = scriptPlanningTurns([literalIntake, compileBrief(VIBE_UPDATE, []), decline]);
        const before = readBrief();

        await sendChatMessage(LITERAL_PROMPT);

        expect(requests).toHaveLength(3);
        expect(readReceipt(requests[2]?.userMessage ?? '', 'brief-compile')).toMatchObject({
            status: 'failure',
            error: { code: 'brief-not-requested', retryable: false },
        });
        expect(countCards()).toBe(0);
        expect(readBrief()).toEqual(before);
    });

    it('refuses a provider that names setProductionBrief as a command', async () => {
        const brief = { ...seededBrief(), revision: 5, vision: VISION };
        const named: ScriptedPlanningTurn = () => [
            {
                id: 'named-brief',
                name: 'command.batch.propose',
                arguments: {
                    commands: [{ name: 'setProductionBrief', arguments: { expectedRevision: 4, brief } }],
                    plan: BRIEF_PLAN,
                },
            },
        ];
        const discover: ScriptedPlanningTurn = () => [
            {
                id: 'discover-brief',
                name: 'agent.catalog.discover',
                arguments: { category: 'command', names: ['setProductionBrief'] },
            },
        ];
        const requests = scriptPlanningTurns([
            literalIntake,
            discover,
            named,
            ...Array.from({ length: 6 }, () => decline),
        ]);
        const before = readBrief();

        await sendChatMessage(LITERAL_PROMPT);

        expect(readReceipt(requests[2]?.userMessage ?? '', 'discover-brief')).toMatchObject({
            status: 'failure',
            data: null,
            error: { code: 'invalid-tool-arguments' },
        });
        expect(chatStore.value?.messages.at(-1)?.error).toContain('undiscovered catalog command');
        expect(countCards()).toBe(0);
        expect(readBrief()).toEqual(before);
    });

    it('waits for confirmation under the most permissive trust ceiling', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        const before = readBrief();

        await sendChatMessage(VIBE_PROMPT, { mode: 'apply', trustCeiling: 'destructive-commit' });

        const { confirmation } = getPendingProposal();
        expect(confirmation.status).toBe('proposed');
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('waiting-for-approval');
        expect(readBrief()).toEqual(before);
    });

    it('refuses a pending card at Confirm once a track role changed the brief, writing nothing', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(VIBE_PROMPT);
        const { confirmation } = getPendingProposal();
        await setTrackCanonicalRole({ trackId: VOCAL_ID, role: 'lead vocal', expectedRevision: 4 });
        const changed = readBrief();
        expect(changed.revision).toBe(5);

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).not.toBe('executed');
        expect(readBrief()).toEqual(changed);
    });

    it.each([
        ['a track the card names is removed', { type: 'removeTrack', payload: { trackId: KEYS_ID } }],
        ['a section the card names is removed', { type: 'removeSection', payload: { sectionId: CHORUS_ID } }],
    ] satisfies [string, AppAction][])(
        'refuses a pending card at Confirm once %s, writing nothing',
        async (_label, edit) => {
            scriptPlanningTurns(BRIEF_ROUTE);
            await sendChatMessage(VIBE_PROMPT);
            const { confirmation } = getPendingProposal();
            await executeAppAction(edit);
            const before = readBrief();

            const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

            expect(result.status).not.toBe('executed');
            expect(JSON.stringify(result)).toContain('production brief names');
            expect(readBrief()).toEqual(before);
        }
    );

    it('refuses a pending card at Confirm once the track its hard constraint names is removed', async () => {
        scriptPlanningTurns([briefIntake, compileBrief({ vision: 'A late-night record' }, []), proposeCompiled()]);
        await sendChatMessage(CONSTRAINED_VIBE_PROMPT);
        const { confirmation } = getPendingProposal();
        await executeAppAction({ type: 'removeTrack', payload: { trackId: VOCAL_ID } });
        const before = readBrief();

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).not.toBe('executed');
        expect(JSON.stringify(result)).toContain(
            `production brief names a track the project no longer holds (${VOCAL_ID})`
        );
        expect(readBrief()).toEqual(before);
    });

    // Any edit rebinds a pending card to the live revision and asks for Confirm again; what matters
    // is that the card survives the edit, and that the second Confirm writes the brief.
    it.each([
        [
            'a fader move on a track it names',
            { type: 'setTrackGain', payload: { trackId: KEYS_ID, gain: 0.5, expectedGain: 0.8 } },
        ],
        ['the removal of a track the brief already names', { type: 'removeTrack', payload: { trackId: DRUMS_ID } }],
    ] satisfies [string, AppAction][])('still confirms a pending card after %s', async (_label, edit) => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(VIBE_PROMPT);
        const { confirmation } = getPendingProposal();
        await executeAppAction(edit);
        const before = readBrief();

        const rebound = await confirmPendingChatActions({ confirmationId: confirmation.id });
        expect(rebound.status).toBe('reapproval_required');
        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).toBe('executed');
        expect(readBrief().revision).toBe(before.revision + 1);
        expect(readBrief().trackRoles.map(({ trackId }) => trackId)).toContain(KEYS_ID);
    });

    it("carries the confirmed brief into a later request's context", async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(VIBE_PROMPT);
        await confirmPendingChatActions({ confirmationId: getPendingProposal().confirmation.id });
        const later = scriptPlanningTurns([decline, decline, decline]);

        await sendChatMessage('What should the next pass focus on?');

        expect(later[0]?.userMessage).toContain(VISION);
        expect(later[0]?.userMessage).toContain('Open up a little');
    });

    it('proposes a brief card for a constrained vibe that is confirmable with no measurement', async () => {
        scriptPlanningTurns([briefIntake, compileBrief({ vision: 'A late-night record' }, []), proposeCompiled()]);

        await sendChatMessage(CONSTRAINED_VIBE_PROMPT);

        const { confirmation } = getPendingProposal();
        expect(confirmation.actions).toMatchObject([
            {
                type: 'setProductionBrief',
                payload: {
                    brief: {
                        hardConstraints: [
                            { scope: { kind: 'track', trackId: VOCAL_ID }, statement: 'keep the vocal intimate' },
                        ],
                    },
                },
            },
        ]);
        const view = getAgentApprovalView({ confirmationId: confirmation.id });
        expect(view?.metricGoals).toMatchObject({ status: 'not-required' });
        expect(view?.canConfirm).toBe(true);
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });
    });

    it('quotes on the brief card each clause of its request that nothing measures, and only those', async () => {
        scriptPlanningTurns([briefIntake, compileBrief({ vision: 'A late-night record' }, []), proposeCompiled()]);

        await sendChatMessage('make this a late-night record but keep the vocal intimate and keep it warm');

        const { message, confirmation } = getPendingProposal();
        expect(confirmation.actions.map((action) => action.type)).toEqual(['setProductionBrief']);
        expect(message.content.split('\n').filter((line) => line.startsWith('Not measured:'))).toEqual([
            'Not measured: “keep it warm” — nothing the application measures shows that it holds.',
        ]);
    });

    it('still joins hold goals from the same constraint wording to a batch that changes sound', () => {
        const context = getProjectContext();
        // The clauses each compiled batch is held to, read from the batch it actually compiled.
        const heldClausesOf = (action: AppAction) => {
            const compiled = compileAgentActionExecution({
                actions: [action],
                actionLabels: [action.type],
                context,
                intent: CONSTRAINED_VIBE_PROMPT,
                projectRevision: captureProjectRevision(),
                runId: 'brief-hold-run',
                group: { groupId: 'brief-hold-group', groupLabel: CONSTRAINED_VIBE_PROMPT },
                requiresConfirmation: true,
            });
            expect(compiled.commandBatch.serialized).toContain(action.type);
            return (metricGoalStateCodec(compiled.metricGoalState)?.authorities ?? []).flatMap((authority) =>
                authority.goals.flatMap((goal) => (goal.source.kind === 'constraint' ? [goal.source.clause] : []))
            );
        };
        const brief = { ...seededBrief(), revision: 5, vision: 'A late-night record' };

        expect(
            heldClausesOf({ type: 'setTrackGain', payload: { trackId: VOCAL_ID, gain: 0.7, expectedGain: 0.8 } })
        ).toEqual(['keep the vocal intimate', 'keep the vocal intimate']);
        expect(heldClausesOf({ type: 'setProductionBrief', payload: { expectedRevision: 4, brief } })).toEqual([]);
    });

    // Three staged renders run real objective DSP, which needs CPU time on loaded runners.
    it('grounds a later batch on a track whose role only the confirmed brief gives', async () => {
        const STEM_ID = 'track-stem';
        landProjectEdit(() => {
            trackStore.set({
                tracks: [{ ...createTrack(STEM_ID, 'Stem 7'), clips: [audioClip(STEM_ID)] }],
                selectedTrackId: null,
                ghostClips: [],
            });
            markerStore.set({
                markers: [],
                sections: [
                    { id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 2, color: '#ffffff' },
                    { id: CHORUS_ID, name: 'Chorus', startBeat: 2, endBeat: 4, color: '#ffffff' },
                ],
            });
        });
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => renderShelvedTone(input));
        const stemRole = { vision: 'A warmer low end', trackRoles: [{ trackId: STEM_ID, role: 'bass' }] };
        scriptPlanningTurns([briefIntake, compileBrief(stemRole, ['warm']), proposeCompiled()]);

        await sendChatMessage('make it warmer');
        // One render per target and document: the stem's whole-song, verse and chorus baselines are
        // windows of one render from beat 0, since no adjustment layer splits the range group.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);

        const brief = getPendingProposal();
        // The stem's name gives no role; only the brief this card writes does, and the plan reads it.
        expect(getProjectContext().tracks[0]?.canonicalRole?.source).not.toBe('authored');
        expect(brief.message.content).toContain('- Batch 2 of 2: warm bass — Stem 7');
        await expect(confirmPendingChatActions({ confirmationId: brief.confirmation.id })).resolves.toEqual({
            status: 'executed',
        });
        // The batch preview adds one render of the stem per document it reads, each holding all three ranges.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(3);

        const batch = pendingActionConfirmationStore.value?.confirmations.find(
            (card) => card.status === 'proposed' && card.runId === brief.confirmation.runId
        );
        expect(batch?.approvalSnapshot.batchPosition).toEqual({ index: 2, total: 2 });
        expect(batch?.approvalSnapshot.adoptedRecipes).toEqual([
            expect.objectContaining({ recipeId: 'bass-warm', targetId: STEM_ID }),
        ]);
        expect(batch?.actions.map((action) => action.type)).toContain('addDevice');
        const view = getAgentApprovalView({ confirmationId: batch?.id ?? '' });
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
                    { startBeat: 0, endBeat: 4, sectionId: null },
                    { startBeat: 0, endBeat: 2, sectionId: 'section-verse' },
                    { startBeat: 2, endBeat: 4, sectionId: CHORUS_ID },
                ].map((range) => ({
                    metricId,
                    relation: metricId === 'frequencyBandEnergy' ? 'increase' : 'decrease',
                    targetIds: [STEM_ID],
                    range,
                    status: 'verified',
                }))
            )
        );
    }, 15_000);

    it('leaves a request whose plan holds no batch exactly the brief alone', async () => {
        // Every track the request could warm is the locked Drums, so its plan holds no batch at all.
        landProjectEdit(() => {
            trackStore.set({ tracks: [createTrack(DRUMS_ID, 'Drums')], selectedTrackId: null, ghostClips: [] });
        });
        const visionOnly = [briefIntake, compileBrief({ vision: VISION }, []), proposeCompiled()];
        scriptPlanningTurns(visionOnly);
        await sendChatMessage(VIBE_PROMPT);
        const briefOnly = getPendingProposal();
        await cancelPendingChatActions({ confirmationId: briefOnly.confirmation.id });
        const briefOnlyContent = briefOnly.message.content;
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        clearPendingActionConfirmations();

        scriptPlanningTurns([briefIntake, compileBrief({ vision: VISION }, ['warm']), proposeCompiled()]);
        await sendChatMessage('make it warmer');

        const { message, confirmation } = getPendingProposal();
        expect(message.content).toBe(briefOnlyContent);
        expect(agentRunLifecycle.get(confirmation.runId)?.plan?.batchSchedule).toBeUndefined();
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(countCards()).toBe(1);
        expect(agentRunLifecycle.get(confirmation.runId)?.phase).toBe('completed');
    });
});

describe('brief.compile refusals', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('brief compile refusal test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        landProjectEdit(() => {
            trackStore.set({
                tracks: [createTrack(VOCAL_ID, 'Vocal'), createTrack(DRUMS_ID, 'Drums')],
                selectedTrackId: null,
                ghostClips: [],
            });
            markerStore.set({
                markers: [],
                sections: [{ id: CHORUS_ID, name: 'Chorus', startBeat: 0, endBeat: 16, color: '#ffffff' }],
            });
            projectStore.set({ ...structuredClone(defaultProjectStoreState), productionBrief: seededBrief() });
        });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    function compileWith(update: Record<string, unknown>) {
        return executeBriefCompile({
            call: { id: 'brief-compile', name: 'brief.compile', arguments: update },
            callId: 'brief-compile',
            turn: 2,
            revision: captureProjectRevision(),
            prompt: VIBE_PROMPT,
            context: getProjectContext(),
            sourceRunId: 'run-1',
            isBriefOffered: true,
            isBriefRequested: () => true,
        });
    }

    it.each([
        ['an unknown track', 'trackRoles', { trackRoles: [{ trackId: 'track-ghost', role: 'keys' }] }],
        ['an unknown section', 'sectionGoals', { sectionGoals: [{ sectionId: 'section-ghost', statement: 'Lift' }] }],
        ['a role outside the canonical set', 'trackRoles', { trackRoles: [{ trackId: VOCAL_ID, role: 'kazoo' }] }],
        ['a link in a reference', 'references', { references: [{ label: 'https://example.com/demo' }] }],
        ['an oversize vision', 'vision', { vision: 'warm '.repeat(200) }],
        ['a role overwrite', 'trackRoles', { trackRoles: [{ trackId: DRUMS_ID, role: 'bass' }] }],
    ])('refuses %s with a receipt naming %s', (_label, field, update) => {
        const before = readBrief();

        const result = compileWith({
            ...update,
            mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: [] },
        });

        expect(result.commands).toBeNull();
        expect(result.receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
        expect(result.receipt.error?.safeMessage.startsWith(`${field}:`)).toBe(true);
        expect(readBrief()).toEqual(before);
    });

    it('refuses malformed mix selections without composing a brief', () => {
        const catalog = getBriefMixIntentCatalog();
        const valid = { catalogId: catalog.catalogId, requestedDescriptors: ['warm'] };
        const invalid: unknown[] = [
            null,
            {},
            { ...valid, catalogId: 'foreign' },
            { ...valid, extra: true },
            { ...valid, requestedDescriptors: ['unknown'] },
            { ...valid, requestedDescriptors: ['warm', 'warm'] },
            { ...valid, requestedDescriptors: [...catalog.descriptors, 'warm'] },
        ];
        for (const mixIntent of invalid) {
            const result = compileWith({ vision: VISION, mixIntent });
            expect(result.commands).toBeNull();
            expect(result.receipt).toMatchObject({
                status: 'failure',
                error: { code: 'invalid-tool-arguments', retryable: true },
            });
        }
        expect(compileWith({ vision: VISION, mixIntent: valid }).receipt.status).toBe('success');
        expect(compileWith({ vision: VISION, mixIntent: { ...valid, requestedDescriptors: [] } }).receipt.status).toBe(
            'success'
        );
    });

    it('refuses an omitted mix intent as invalid tool arguments', () => {
        const result = compileWith({ vision: VISION });
        expect(result.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments', retryable: true },
        });
    });

    it('refuses a request the brief was not offered to, as the Prompt Bar is', () => {
        const result = executeBriefCompile({
            call: {
                id: 'brief-compile',
                name: 'brief.compile',
                arguments: {
                    vision: VISION,
                    mixIntent: { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: [] },
                },
            },
            callId: 'brief-compile',
            turn: 2,
            revision: captureProjectRevision(),
            prompt: VIBE_PROMPT,
            context: getProjectContext(),
            sourceRunId: null,
            isBriefOffered: false,
            isBriefRequested: () => true,
        });

        expect(result.commands).toBeNull();
        expect(result.receipt).toMatchObject({ status: 'failure', error: { code: 'brief-not-requested' } });
    });
});
