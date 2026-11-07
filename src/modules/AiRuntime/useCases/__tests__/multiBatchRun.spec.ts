import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    initEngineDeviceCollaborators,
    removeTrackStrip,
    type renderTrackSubgraphOffline,
} from '#/modules/AudioEngine/useCases';
import { registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { groundVibeRunBatch } from '../agentRequestOrchestration/groundVibeRunBatch';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';
import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';

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

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
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
    { id: 'brief-compile', name: 'brief.compile', arguments: { vision: 'A warmer, more open mix' } },
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
 * Every track sounds a 100 Hz body beside a 3 kHz top, each scaled by the low and high shelf gains
 * of the EQs it carries, so a warming recipe raises the bass band and lowers the centroid.
 */
function renderTrack(input: RenderInput): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const parameter = (id: string) =>
        track.devices.reduce((total, device) => total + (device.parameterValues[id] ?? 0), 0);
    const low = 10 ** (parameter('eq-low-gain') / 20);
    const high = 10 ** (parameter('eq-high-gain') / 20);
    const seconds = (input.endBeat - input.startBeat) / 2;
    return metricGoalAudioBuffer(
        (time) => 0.4 * low * Math.sin(2 * Math.PI * 100 * time) + 0.2 * high * Math.sin(2 * Math.PI * 3000 * time),
        seconds
    );
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

/** Writes the brief one revision on, as a user's own brief edit does, through its typed command. */
async function editBrief(): Promise<void> {
    const brief = projectStore.value?.productionBrief;
    if (brief === undefined) {
        throw new TypeError('Expected an open project with a brief');
    }
    await executeAppAction({
        type: 'setProductionBrief',
        payload: {
            expectedRevision: brief.revision,
            brief: { ...structuredClone(brief), revision: brief.revision + 1, vision: 'Dark and close instead' },
        },
    });
}

/** Sends the request and confirms its brief card, so the run proposes its first batch. */
async function confirmBrief(): Promise<Confirmation> {
    scriptPlanningTurns(BRIEF_ROUTE);
    await sendChatMessage(PROMPT);
    const brief = requireOnlyProposedCard();
    await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
    return brief;
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'multi-batch vibe run test',
        tracks: [sourceTrack(DRUMS_ID, 'Drums'), sourceTrack(VOCAL_ID, 'Vocal'), sourceTrack(BASS_ID, 'Bass')],
        sections: [],
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
    for (const trackId of [DRUMS_ID, VOCAL_ID, BASS_ID]) {
        removeTrackStrip(trackId);
    }
    audioEngine.setUseCaseDeviceCollaborators(null);
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    clearAiHistory();
    resetMetricGoalProject();
    vi.restoreAllMocks();
});

describe('a whole-project vibe run of measured recipe batches (AC-003 of #4372)', () => {
    it('lists the planned batches on the brief card and applies nothing before Confirm', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage(PROMPT);

        const brief = requireOnlyProposedCard();
        expect(brief.actions.map((action) => action.type)).toEqual(['setProductionBrief']);
        expect(cardContent(brief)).toContain(
            [
                'After the brief, 3 batches follow, each measured, previewed and approved on its own:',
                '- Batch 2 of 4: warm drums — Drums',
                '- Batch 3 of 4: warm vocal — Vocal',
                '- Batch 4 of 4: warm bass — Bass',
            ].join('\n')
        );
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toMatchObject({
            kind: 'vibe-run',
            position: 1,
            total: 4,
            briefRevision: PLANNED_BRIEF_REVISION,
        });
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });

    it('approves each batch in turn, each grounded at the revision the batch before it left', async () => {
        const brief = await confirmBrief();
        const seen: Confirmation[] = [];

        for (const [index, targetId] of [DRUMS_ID, VOCAL_ID, BASS_ID].entries()) {
            const position = index + 2;
            const card = requireOnlyProposedCard();
            seen.push(card);
            expect(card.runId).toBe(brief.runId);
            expect(card.approvalSnapshot.batchPosition).toEqual({ index: position, total: 4 });
            // Grounded after the batch before it committed, at the revision that commit left.
            expect(card.projectRevision).toBe(captureProjectRevision());
            expect(card.approvalSnapshot.adoptedRecipes?.map((recipe) => recipe.targetId)).toEqual([targetId]);
            expect(cardContent(card)).toMatch(new RegExp(`^Batch ${String(position)} of 4: `, 'u'));
            expect(cardContent(card)).toContain('Measured on ');
            expect(cardContent(card)).not.toContain('(blocked)');
            const state = metricGoalStateCodec(card.approvalSnapshot.metricGoalState);
            expect(state?.authorities.map((authority) => authority.origin)).toEqual(['vibe-run-plan']);
            expect(state?.proofs.length).toBeGreaterThan(0);
            expect(trackDeviceTypes(targetId)).toEqual([]);

            await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(trackDeviceTypes(targetId)).toEqual(['builtin-eq']);
        }

        expect(new Set(seen.map((card) => card.projectRevision)).size).toBe(3);
        expect(proposedCards()).toEqual([]);
        expect(lastMessage()).toMatch(
            /^The vibe run finished: the brief and 3 of 3 batches were applied\.\n- Batch 2 \(warm drums\): .+\n- Batch 3 \(warm vocal\): .+\n- Batch 4 \(warm bass\): .+$/u
        );
        expect(lastMessage()).toContain('on Drums');
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
    });

    it('stops on a rejected batch, saying which batches stayed applied, and proposes no later batch', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'executed',
        });
        const vocal = requireOnlyProposedCard();

        await expect(cancelPendingChatActions({ confirmationId: vocal.id })).resolves.toEqual({
            status: 'cancelled',
        });

        expect(cardContent(vocal)).toMatch(/^Cancelled pending actions:\n\n- .+\n\nBatches 1–2 remain applied\.$/su);
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        expect(liveBriefRevision()).toBe(PLANNED_BRIEF_REVISION);
        // The run committed the brief and one batch, so it ends partially completed, not cancelled whole.
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });

    it.each([
        { settlement: 'reject', cleared: false },
        { settlement: 'resolve', cleared: false },
        { settlement: 'reject', cleared: true },
        { settlement: 'resolve', cleared: true },
    ] as const)(
        'settles a cancelled later preview with $settlement (chat cleared: $cleared)',
        async ({ settlement, cleared }) => {
            const brief = await confirmBrief();
            const drums = requireOnlyProposedCard();
            let admitted!: () => void;
            const admission = new Promise<void>((resolve) => {
                admitted = resolve;
            });
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            audio.renderTrackSubgraphOffline.mockImplementationOnce(async (input: RenderInput) => {
                admitted();
                await held;
                if (settlement === 'reject') {
                    throw new Error('held preview failed');
                }
                return renderTrack(input);
            });
            const confirmation = confirmPendingChatActions({ confirmationId: drums.id });
            await admission;
            await expect(
                agentRunCancellation.cancel({ runId: brief.runId, reason: 'Cancelled by user' })
            ).resolves.toMatchObject({
                status: 'cancelled',
                phase: 'partially-completed',
            });
            const cancelled = agentRunLifecycle.get(brief.runId);
            expect(cancelled?.batches.at(-1)?.status).toBe('cancelled');
            const errors = structuredClone(cancelled?.errors);
            const revision = captureProjectRevision();
            const tracks = structuredClone(trackStore.value);
            const history = structuredClone(undoHistoryStore.value);
            const preparing = chatStore.value?.messages.find(
                (message) => message.content === 'Preparing batch 3 of 4...'
            );
            expect(preparing).toBeDefined();
            const otherMessages = chatStore.value?.messages.filter((message) => message.id !== preparing?.id);
            if (cleared) {
                clearChatMessages();
            }
            release();
            await expect(confirmation).resolves.toEqual({ status: 'executed' });
            const settled = agentRunLifecycle.get(brief.runId);
            expect(settled?.phase).toBe('partially-completed');
            expect(settled?.batches.at(-1)?.status).toBe('cancelled');
            expect(settled?.errors).toEqual(errors);
            expect(captureProjectRevision()).toBe(revision);
            expect(trackStore.value).toEqual(tracks);
            expect(undoHistoryStore.value).toEqual(history);
            if (cleared) {
                expect(chatStore.value?.messages).toEqual([]);
            } else {
                expect(chatStore.value?.messages.find((message) => message.id === preparing?.id)).toMatchObject({
                    content: 'Cancelled preparation of batch 3 of 4. Batches 1–2 remain applied.',
                    pendingActionConfirmationStatus: 'cancelled',
                });
                expect(chatStore.value?.messages.filter((message) => message.id !== preparing?.id)).toEqual(
                    otherMessages
                );
            }
            expect(chatStore.value?.messages.some((message) => message.content.startsWith('Preparing batch'))).toBe(
                false
            );
            expect(proposedCards()).toEqual([]);
            expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
            expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
            expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        }
    );

    it('blocks approval and retains the failure receipt when a later preview render fails', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        audio.renderTrackSubgraphOffline.mockRejectedValueOnce(new Error('preview failed'));

        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({ status: 'executed' });

        const card = requireOnlyProposedCard();
        expect(getAgentApprovalView({ confirmationId: card.id })).toMatchObject({
            canConfirm: false,
            metricGoals: { status: 'blocked' },
        });
        const run = agentRunLifecycle.get(brief.runId);
        expect(run?.phase).toBe('waiting-for-approval');
        expect(run?.plan?.applicationToolReceipts).toContainEqual(
            expect.objectContaining({
                status: 'failure',
                error: expect.objectContaining({ code: 'render-failed', retryable: false }),
            })
        );
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
    });

    it('stops on the first batch rejected, saying the brief alone stayed applied', async () => {
        await confirmBrief();
        const drums = requireOnlyProposedCard();

        await expect(cancelPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'cancelled',
        });

        expect(cardContent(drums)).toMatch(/^Cancelled pending actions:\n\n- .+\n\nBatch 1 remains applied\.$/su);
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
    });

    it('stops on a batch whose target was frozen since planning, with the earlier batches applied', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        // The plan was read with the Vocal open; it freezes before the brief is confirmed, so the
        // brief card asks once to be approved again and the plan still names the Vocal.
        landProjectEdit(() => {
            const state = trackStore.value;
            if (state === null) {
                throw new TypeError('Expected an open project with tracks');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === VOCAL_ID ? { ...track, frozen: true } : track)),
            });
        });
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toMatchObject({
            status: 'reapproval_required',
        });
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });
        const drums = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(lastMessage()).toBe(
            'Batch 3 of 4 was not proposed: its target “Vocal” is frozen. Batches 1–2 remain applied.'
        );
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
        expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });

    it('refuses a later batch once the brief changed since the run was planned', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();

        await editBrief();

        await expect(reproposePendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'rejected',
            reason: `The production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)}).`,
        });
        const run = agentRunLifecycle.get(brief.runId);
        const schedule = run?.plan?.batchSchedule;
        if (run === null || schedule?.kind !== 'vibe-run') {
            throw new TypeError('Expected the vibe run and its schedule');
        }
        expect(groundVibeRunBatch(run, schedule, 3)).toEqual({
            status: 'rejected',
            reason: `production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)})`,
        });
        expect(trackDeviceTypes(VOCAL_ID)).toEqual([]);
    });

    it('refuses Confirm of a parked batch once the brief changed, before asking for any re-approval', async () => {
        const brief = await confirmBrief();
        const drums = requireOnlyProposedCard();
        await editBrief();

        const reason = `The production brief changed since this run was planned (rev ${String(PLANNED_BRIEF_REVISION)} → ${String(PLANNED_BRIEF_REVISION + 1)}).`;
        await expect(confirmPendingChatActions({ confirmationId: drums.id })).resolves.toEqual({
            status: 'failed',
            reason,
        });

        expect(cardContent(drums)).toContain(reason);
        expect(proposedCards()).toEqual([]);
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('partially-completed');
    });

    it('waits for each batch’s own approval under the most permissive trust ceiling', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT, { mode: 'apply', trustCeiling: 'destructive-commit' });
        const brief = requireOnlyProposedCard();
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toMatchObject({
            kind: 'vibe-run',
            trustCeiling: 'destructive-commit',
        });

        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });

        const drums = requireOnlyProposedCard();
        expect(drums.approvalSnapshot.batchPosition).toEqual({ index: 2, total: 4 });
        expect(trackDeviceTypes(DRUMS_ID)).toEqual([]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('waiting-for-approval');
    });

    it('plans no batch for a quality the request withholds', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage("make this mix warmer but don't let the vocal get brighter");

        const content = cardContent(requireOnlyProposedCard());
        expect(content).toContain(
            [
                'After the brief, 3 batches follow, each measured, previewed and approved on its own:',
                '- Batch 2 of 4: warm drums — Drums',
                '- Batch 3 of 4: warm vocal — Vocal',
                '- Batch 4 of 4: warm bass — Bass',
            ].join('\n')
        );
        expect(content).not.toContain('bright');
    });

    it('schedules nothing when the render budget cannot preview every batch, and says why', async () => {
        agentResourceLimitsStore.set({ ...readAgentResourceLimits(), maxRenderJobs: 4 });
        scriptPlanningTurns(BRIEF_ROUTE);

        await sendChatMessage(PROMPT);

        const brief = requireOnlyProposedCard();
        expect(cardContent(brief)).toContain(
            "No batches were scheduled after the brief: previewing every batch needs 6 renders, more than the 4 this run's maxRenderJobs budget has left."
        );
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });
        expect(proposedCards()).toEqual([]);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
    });

    it('keeps a vibe-run schedule through a store round trip and drops a tampered one', async () => {
        scriptPlanningTurns(BRIEF_ROUTE);
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
        expect(schedule?.kind).toBe('vibe-run');

        // The run state persists as JSON, so the schedule must survive being written as text.
        const persistedText = JSON.stringify(readAgentRunState());
        const restored = sanitizeAgentRunState(JSON.parse(persistedText));
        expect(restored.runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule).toEqual(schedule);

        const tampered = structuredClone(readAgentRunState());
        const stored = tampered.runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule;
        if (stored?.kind !== 'vibe-run') {
            throw new TypeError('Expected the stored vibe-run schedule');
        }
        // A plan read from another brief revision than the schedule records is refused whole.
        stored.briefRevision = PLANNED_BRIEF_REVISION + 1;
        expect(
            sanitizeAgentRunState(tampered).runs.find((run) => run.runId === brief.runId)?.plan?.batchSchedule
        ).toBeUndefined();
    });
});
