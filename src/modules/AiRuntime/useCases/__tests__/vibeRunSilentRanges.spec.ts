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
import { registerHandlerMap } from '#/modules/Command/stores';
import { setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { digest } from '#/utils/canonicalDigest';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import {
    type MeasuredScheduledVibeRunPlan,
    type VibeRunSilentRange,
    type VibeRunSilentTarget,
} from '../../models/VibeRunPlan';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { groundVibeRunBatch } from '../agentRequestOrchestration/groundVibeRunBatch';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';
import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * #4372: a planned track that carries no signal over one verification range is scheduled around it,
 * with no goal there, bound to the receipt that shows the silence; a track silent in every range is
 * left out and listed. The harness follows `vibeRunInitialBaselines.spec.ts`.
 */
const PROMPT = 'make this mix warmer and more open';
const BRIEF_REVISION = 4;

const DRUMS_ID = 'track-drums';
const VOCAL_ID = 'track-vocal';
const BASS_ID = 'track-bass';
const CHORUS_START = 2;

const COMPLETE_RUN_TIMEOUT_MS = 15_000;

/** A batch grounded straight from its plan, as a local backend grounds it: every recipe at its defaults. */
const LOCAL_DEFAULTS = { source: 'catalogue-defaults', reason: 'local-backend', detail: '' } as const;

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
// carry no schedulable timeline.
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

function scriptBriefRoute(): void {
    const turns = [briefIntake, compileBrief, proposeBrief];
    let calls = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        const turn = turns[calls];
        calls += 1;
        if (turn === undefined) {
            throw new Error(`Expected at most ${String(turns.length)} provider turns`);
        }
        return { status: 'complete', toolCalls: turn({ userMessage, schemas }) };
    });
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

/**
 * A render as the song it holds: its first frame is the song at its start beat (two beats a second),
 * so every range read out of a wider render holds that range's own samples.
 */
function renderSong(input: RenderInput, sample: (songSeconds: number) => number): AudioBuffer {
    const startSeconds = input.startBeat / 2;
    return metricGoalAudioBuffer((time) => sample(startSeconds + time), (input.endBeat - input.startBeat) / 2);
}

/** A 100 or 220 Hz body beside a 3 kHz top, each scaled by the shelf gains of the EQs the track carries. */
function soundingSample(input: RenderInput): (songSeconds: number) => number {
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
        const brightness = song >= CHORUS_START / 2 ? 0.35 : 0.15;
        return (
            0.4 * low * Math.sin(2 * Math.PI * frequency * song) +
            brightness * high * Math.sin(2 * Math.PI * 3000 * song)
        );
    };
}

function silence(input: RenderInput): AudioBuffer {
    return renderSong(input, () => 0);
}

/** Drums rest through the chorus; Bass is silent in every range; Vocal sounds throughout. */
function renderWithSilences(input: RenderInput): AudioBuffer {
    if (input.targetTrackId === BASS_ID) {
        return silence(input);
    }
    const sounding = soundingSample(input);
    if (input.targetTrackId === DRUMS_ID) {
        return renderSong(input, (song) => (song >= CHORUS_START / 2 ? 0 : sounding(song)));
    }
    return renderSong(input, sounding);
}

async function sendChatMessage(prompt: string) {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt);
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

function trackDeviceTypes(trackId: string): string[] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.devices.map((device) => device.type) ?? [];
}

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

function requireSchedule(card: Confirmation) {
    const run = agentRunLifecycle.get(card.runId);
    const schedule = run?.plan?.batchSchedule;
    if (run === null || run === undefined || schedule?.kind !== 'vibe-run') {
        throw new Error('Expected a measured schedule.');
    }
    return { run, schedule };
}

/** Re-seal a tampered plan's digests so only the tampered field can make the reader refuse it. */
function resealed(
    plan: Pick<MeasuredScheduledVibeRunPlan, 'briefRevision' | 'initial'> & { batches: unknown }
): string {
    const initialDigest = digest(plan.initial);
    return JSON.stringify({
        ...plan,
        initialDigest,
        planDigest: digest({ briefRevision: plan.briefRevision, batches: plan.batches, initialDigest }),
    });
}

/** Re-bind every recorded receipt digest after a receipt is edited, so only the edited figures can refuse. */
function rebound(plan: MeasuredScheduledVibeRunPlan): MeasuredScheduledVibeRunPlan {
    const digestOf = (callId: string) => digest(plan.initial.receipts.find((receipt) => receipt.callId === callId));
    const rebind = <Entry extends { receiptCallId: string }>(entry: Entry) => ({
        ...entry,
        receiptDigest: digestOf(entry.receiptCallId),
    });
    const silentEvidence: { silentTargets?: VibeRunSilentTarget[] } = {};
    if (plan.initial.silentTargets !== undefined) {
        silentEvidence.silentTargets = plan.initial.silentTargets.map((entry) => ({
            ...entry,
            silences: entry.silences.map(rebind),
        }));
    }
    const initial = { ...plan.initial, witnesses: plan.initial.witnesses.map(rebind), ...silentEvidence };
    return { ...plan, batches: plan.batches.map((batch) => withSilentRanges(batch, rebind)), initial };
}

/** The batch with each of its silence records mapped; a batch with none is returned as it is. */
function withSilentRanges(
    batch: MeasuredScheduledVibeRunPlan['batches'][number],
    map: (record: VibeRunSilentRange) => VibeRunSilentRange
): MeasuredScheduledVibeRunPlan['batches'][number] {
    if (batch.silentRanges === undefined) {
        return batch;
    }
    return { ...batch, silentRanges: batch.silentRanges.map(map) };
}

const CHORUS = { startBeat: 2, endBeat: 4, sectionId: 'chorus' };

function isDrumsOverChorus(entry: {
    targetIds?: readonly string[];
    targetId?: string;
    range: { sectionId: string | null } | null;
}) {
    const targets = entry.targetIds ?? (entry.targetId === undefined ? [] : [entry.targetId]);
    return targets.includes(DRUMS_ID) && entry.range?.sectionId === 'chorus';
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'vibe run silent ranges test',
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
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: {
                ...structuredClone(defaultProjectStoreState.productionBrief),
                revision: BRIEF_REVISION,
                createdAt: 100,
                updatedAt: 100,
            },
        });
    });
    vi.mocked(generateToolPlanningOutcome).mockReset();
    runtimeMocks.backend.value = 'cloud';
    audio.renderTrackSubgraphOffline
        .mockReset()
        .mockImplementation(async (input: RenderInput) => renderWithSilences(input));
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

describe('a vibe run around silent verification ranges', () => {
    it(
        'schedules a track silent over one section with no goal there and leaves out a track silent everywhere',
        async () => {
            scriptBriefRoute();
            await sendChatMessage(PROMPT);
            const brief = requireOnlyProposedCard();
            const plan = measuredPlan(brief);

            // The renders really read silence: every figure of the silent cells is `unavailable: silent`.
            const receipts = plan.initial.receipts.map((receipt) => {
                const read = readVibeRunInitialReceipt(receipt);
                if (read === null) {
                    throw new Error('Expected an admitted initial receipt.');
                }
                return read;
            });
            const chorusReceipt = receipts.find((receipt) => receipt.data.range.sectionId === 'chorus');
            const drumsInChorus = chorusReceipt?.data.targets.find((target) => target.targetId === DRUMS_ID);
            expect(Object.values(drumsInChorus?.measurements ?? {})).not.toHaveLength(0);
            for (const entry of Object.values(drumsInChorus?.measurements ?? {})) {
                expect(entry).toEqual({ status: 'unavailable', reason: 'silent' });
            }

            expect(plan.batches.map((batch) => batch.targetIds)).toEqual([[DRUMS_ID], [VOCAL_ID]]);
            const [drums, vocal] = plan.batches;
            expect(drums?.silentRanges).toEqual([
                {
                    targetId: DRUMS_ID,
                    range: CHORUS,
                    receiptCallId: chorusReceipt?.callId,
                    receiptDigest: digest(plan.initial.receipts.find((r) => r.callId === chorusReceipt?.callId)),
                },
            ]);
            expect(vocal?.silentRanges).toBeUndefined();
            expect(plan.initial.witnesses.filter(isDrumsOverChorus)).toEqual([]);
            expect(plan.initial.witnesses.some((witness) => witness.targetId === BASS_ID)).toBe(false);
            const witnessRanges = (targetId: string) =>
                new Set(
                    plan.initial.witnesses
                        .filter((witness) => witness.targetId === targetId)
                        .map((witness) => `${witness.range.sectionId ?? 'arrangement'}:${witness.metric}`)
                );
            const metrics = ['frequencyBandEnergy', 'spectralCentroid'];
            expect(witnessRanges(VOCAL_ID)).toEqual(
                new Set(['arrangement', 'verse', 'chorus'].flatMap((range) => metrics.map((m) => `${range}:${m}`)))
            );
            expect(witnessRanges(DRUMS_ID)).toEqual(
                new Set(['arrangement', 'verse'].flatMap((range) => metrics.map((m) => `${range}:${m}`)))
            );

            const content = cardContent(brief);
            expect(content).toMatch(/Not planned: Bass, because [^.\n]*silent[^.\n]*\./u);
            expect(content).toContain('No goal for Drums over Chorus [2, 4]: it is silent there.');
            expect(content).not.toMatch(/Initial measurement on Drums, Chorus/u);
            expect(content).not.toMatch(/Initial measurement on Bass/u);
            expect(content).toMatch(/Initial measurement on Drums, Verse/u);
            expect(content).toMatch(/Initial measurement on Vocal, Chorus/u);

            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });
            const drumsCard = requireOnlyProposedCard();
            const drumsState = metricGoalStateCodec(drumsCard.approvalSnapshot.metricGoalState);
            const drumsGoals = drumsState?.authorities.flatMap((authority) => authority.goals) ?? [];
            expect(drumsGoals.filter(isDrumsOverChorus)).toEqual([]);
            expect(new Set(drumsGoals.map((goal) => goal.range?.sectionId))).toEqual(new Set([null, 'verse']));
            expect(drumsState?.proofs.some((proof) => proof.preview.range.sectionId === 'chorus')).toBe(false);
            const drumsView = getAgentApprovalView({ confirmationId: drumsCard.id });
            expect(drumsView?.canConfirm).toBe(true);
            expect(drumsView?.metricGoals.criteria.some((criterion) => criterion.range?.sectionId === 'chorus')).toBe(
                false
            );
            expect(cardContent(drumsCard)).not.toContain('chorus [2, 4]');
            await expect(confirmPendingChatActions({ confirmationId: drumsCard.id })).resolves.toEqual({
                status: 'executed',
            });

            const vocalCard = requireOnlyProposedCard();
            const vocalState = metricGoalStateCodec(vocalCard.approvalSnapshot.metricGoalState);
            expect(
                new Set(vocalState?.authorities.flatMap((authority) => authority.goals.map((g) => g.range?.sectionId)))
            ).toEqual(new Set([null, 'verse', 'chorus']));
            await expect(confirmPendingChatActions({ confirmationId: vocalCard.id })).resolves.toEqual({
                status: 'executed',
            });
            expect(trackDeviceTypes(DRUMS_ID)).toEqual(['builtin-eq']);
            expect(trackDeviceTypes(VOCAL_ID)).toEqual(['builtin-eq']);
            expect(trackDeviceTypes(BASS_ID)).toEqual([]);
        },
        COMPLETE_RUN_TIMEOUT_MS
    );

    it('does not schedule a run whose every planned track is silent in every range', async () => {
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => silence(input));
        scriptBriefRoute();
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
        const content = cardContent(brief);
        expect(content).toContain('No batches were scheduled after the brief');
        expect(content).toContain('silent');
        expect(content).toMatch(/Not planned: Drums, because [^.\n]*silent/u);
        expect(content).not.toContain('Initial measurement on');
    });

    it('refuses a stored plan whose silence record no longer matches its receipt', async () => {
        scriptBriefRoute();
        await sendChatMessage(PROMPT);
        const plan = measuredPlan(requireOnlyProposedCard());
        const [drums] = plan.batches;
        const [record] = drums?.silentRanges ?? [];
        if (drums === undefined || record === undefined) {
            throw new Error('Expected a drums silence record.');
        }
        expect(readScheduledVibeRunPlan(resealed(structuredClone(plan)))).not.toBeNull();
        const verseReceipt = plan.initial.receipts.find((receipt) => {
            const read = readVibeRunInitialReceipt(receipt);
            return read?.data.range.sectionId === 'verse';
        });
        const verseWitnessIds = new Set(
            plan.initial.witnesses
                .filter((witness) => witness.targetId === DRUMS_ID && witness.range.sectionId === 'verse')
                .map((witness) => witness.id)
        );
        const withDrums = (patch: Partial<NonNullable<typeof drums>>) => (value: MeasuredScheduledVibeRunPlan) => ({
            ...value,
            batches: value.batches.map((batch) => (batch.id === drums.id ? { ...batch, ...patch } : batch)),
        });
        const tampers: Record<string, (value: MeasuredScheduledVibeRunPlan) => MeasuredScheduledVibeRunPlan> = {
            'digest mismatch': withDrums({ silentRanges: [{ ...record, receiptDigest: 'stale' }] }),
            'unknown receipt': withDrums({ silentRanges: [{ ...record, receiptCallId: 'missing-call' }] }),
            'range other than its receipt': withDrums({
                silentRanges: [{ ...record, range: { startBeat: 0, endBeat: 2, sectionId: 'verse' } }],
            }),
            'missing record': withDrums({ silentRanges: [] }),
            'duplicate record': withDrums({ silentRanges: [record, record] }),
            'foreign target': withDrums({ silentRanges: [{ ...record, targetId: VOCAL_ID }] }),
            // The verse receipt is real and its digest matches, but Drums is measured there.
            'target measured at its receipt': (value) => ({
                ...withDrums({
                    silentRanges: [
                        record,
                        {
                            targetId: DRUMS_ID,
                            range: { startBeat: 0, endBeat: 2, sectionId: 'verse' },
                            receiptCallId: verseReceipt?.callId ?? '',
                            receiptDigest: digest(verseReceipt),
                        },
                    ],
                    witnessIds: (drums.witnessIds ?? []).filter((id) => !verseWitnessIds.has(id)),
                })(value),
                initial: {
                    ...value.initial,
                    witnesses: value.initial.witnesses.filter((witness) => !verseWitnessIds.has(witness.id)),
                },
            }),
        };
        for (const [name, tamper] of Object.entries(tampers)) {
            expect([name, readScheduledVibeRunPlan(resealed(tamper(structuredClone(plan))))]).toEqual([name, null]);
        }
        const unknownShape = {
            ...plan,
            batches: plan.batches.map((batch) =>
                batch.id === drums.id ? { ...batch, silentRanges: [{ ...record, range: 'chorus' }] } : batch
            ),
        };
        expect(readScheduledVibeRunPlan(resealed(unknownShape))).toBeNull();
    });

    it('refuses a stored plan whose silent-everywhere exclusion lacks the evidence a silent cell needs', async () => {
        scriptBriefRoute();
        await sendChatMessage(PROMPT);
        const plan = measuredPlan(requireOnlyProposedCard());
        const [bass] = plan.initial.silentTargets ?? [];
        if (bass === undefined) {
            throw new Error('Expected the silent Bass exclusion.');
        }
        expect(bass.targetId).toBe(BASS_ID);
        expect(bass.silences.map((silence) => silence.range.sectionId)).toEqual([null, 'verse', 'chorus']);
        const withBass = (patch: Partial<typeof bass>) => (value: MeasuredScheduledVibeRunPlan) => ({
            ...value,
            initial: { ...value.initial, silentTargets: [{ ...bass, ...patch }] },
        });
        const withBassFigures =
            (figures: (measurements: Record<string, unknown>) => void) => (value: MeasuredScheduledVibeRunPlan) => {
                for (const receipt of value.initial.receipts) {
                    const target = readVibeRunInitialReceipt(receipt)?.data.targets.find((t) => t.targetId === BASS_ID);
                    if (target !== undefined) {
                        figures(target.measurements);
                    }
                }
                return rebound(value);
            };
        const everyFigure = (reason: string) => (measurements: Record<string, unknown>) => {
            for (const key of Object.keys(measurements)) {
                Object.assign(measurements, { [key]: { status: 'unavailable', reason } });
            }
        };
        const [first, second, third] = bass.silences;
        if (first === undefined || second === undefined || third === undefined) {
            throw new Error('Expected one silence per plan range.');
        }
        const tampers: Record<string, (value: MeasuredScheduledVibeRunPlan) => MeasuredScheduledVibeRunPlan> = {
            'too-short figures': withBassFigures(everyFigure('too-short')),
            'below-gate figures': withBassFigures(everyFigure('below-gate')),
            'empty figures': withBassFigures((measurements) => {
                for (const key of Object.keys(measurements)) {
                    Reflect.deleteProperty(measurements, key);
                }
            }),
            'a range without its silence': withBass({ silences: [first, second] }),
            'a duplicate range': withBass({ silences: [first, second, second] }),
            'an extra range': withBass({
                silences: [first, second, third, { ...third, range: { startBeat: 0, endBeat: 1, sectionId: null } }],
            }),
            'a target also in a batch': withBass({
                targetId: DRUMS_ID,
                silences: bass.silences.map((silence) => ({ ...silence, targetId: DRUMS_ID })),
            }),
            'empty metrics': withBass({ metrics: [] }),
            'receipt digest mismatch': withBass({ silences: [{ ...first, receiptDigest: 'stale' }, second, third] }),
            'a receipt target with no entry': (value) => {
                const { silentTargets: _silentTargets, ...initial } = value.initial;
                return { ...value, initial };
            },
        };
        for (const [name, tamper] of Object.entries(tampers)) {
            expect([name, readScheduledVibeRunPlan(resealed(tamper(structuredClone(plan))))]).toEqual([name, null]);
        }
        expect(readScheduledVibeRunPlan(resealed(rebound(structuredClone(plan))))).not.toBeNull();
    });

    it('refuses through its plan reader to ground a batch whose silence record went stale', async () => {
        scriptBriefRoute();
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });
        const { run, schedule } = requireSchedule(brief);
        const plan = measuredPlan(brief);
        expect(groundVibeRunBatch(run, schedule, 2, LOCAL_DEFAULTS)).toMatchObject({ status: 'grounded' });
        const stale = {
            ...plan,
            batches: plan.batches.map((batch) =>
                withSilentRanges(batch, (record) => ({ ...record, receiptDigest: 'stale' }))
            ),
        };
        expect(groundVibeRunBatch(run, { ...schedule, serializedPlan: resealed(stale) }, 2, LOCAL_DEFAULTS)).toEqual({
            status: 'rejected',
            reason: 'its stored plan could not be read back',
        });
    });

    it('still refuses a silence-bearing batch whose catalogue changed or whose target was removed', async () => {
        scriptBriefRoute();
        await sendChatMessage(PROMPT);
        const brief = requireOnlyProposedCard();
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
            status: 'executed',
        });
        const { run, schedule } = requireSchedule(brief);
        const plan = measuredPlan(brief);
        expect(plan.batches[0]?.silentRanges).toHaveLength(1);
        const newerCatalogue = {
            ...plan,
            initial: { ...plan.initial, catalogVersion: plan.initial.catalogVersion + 1 },
        };
        expect(
            groundVibeRunBatch(run, { ...schedule, serializedPlan: resealed(newerCatalogue) }, 2, LOCAL_DEFAULTS)
        ).toEqual({
            status: 'rejected',
            reason: 'its recipe catalog changed since initial measurement',
        });
        const tracks = trackStore.value;
        if (tracks === null) {
            throw new Error('Missing tracks.');
        }
        landProjectEdit(() =>
            trackStore.set({ ...tracks, tracks: tracks.tracks.filter((track) => track.id !== DRUMS_ID) })
        );
        expect(groundVibeRunBatch(run, schedule, 2, LOCAL_DEFAULTS)).toEqual({
            status: 'rejected',
            // The plan's frozen role table sees the removal before the live target check does.
            reason: `target ${DRUMS_ID} changed role since initial measurement`,
        });
    });
});
