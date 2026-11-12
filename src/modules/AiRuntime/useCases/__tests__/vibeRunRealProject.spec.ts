import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { MAX_METRIC_GOAL_STATE_BYTES } from '../../models/MetricGoalAdmission';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import {
    APPLICATION_OWNED_TOOL_LOOP_LIMITS,
    APPLICATION_VERIFICATION_RECEIPT_LIMITS,
} from '../applicationOwnedToolLoop';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { sendChatMessage } from '../sendChatMessage';

import { configureMetricGoalProject, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import {
    ORDINARY_SONG_BEATS as SONG_BEATS,
    ORDINARY_SONG_SECTIONS as SECTIONS,
    ORDINARY_SONG_TRACKS as TRACKS,
    prepareVibeRunEngine,
    releaseVibeRunEngine,
    renderVibeTimeline,
    requireOnlyProposedVibeCard,
    scriptVibeBriefRoute,
    seedVibeBrief,
    sendVibeMessage,
    SECONDS_PER_BEAT,
    vibeCardContent,
    vibeTrack,
    type VibeRenderInput,
} from './vibeRunProjectFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * #4372 requirement 2: a whole-project vibe run over a song of ordinary size — five role families of
 * unequal size, one larger than a batch holds, eight sections and two requested characters — fits
 * the default resource limits and plans every plannable track into a batch.
 */
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

/**
 * Whether the fixture's figures move the way each recipe expects is not what the whole-run case
 * observes: the fixture renders mono, so no wide recipe's side energy can rise. That case admits a
 * batch whose first failing criterion read and compared its figures but fell outside its
 * tolerance; a missing, incomparable or stale figure still blocks it.
 */
const admission = vi.hoisted(() => ({ admitsOutOfTolerance: false }));
vi.mock('../evaluateMetricGoalAdmission', async (importOriginal) => {
    const original = await importOriginal<typeof import('../evaluateMetricGoalAdmission')>();
    return {
        ...original,
        evaluateMetricGoalAdmission: (input: Parameters<typeof original.evaluateMetricGoalAdmission>[0]) => {
            const evaluation = original.evaluateMetricGoalAdmission(input);
            return admission.admitsOutOfTolerance && evaluation.failure === 'out-of-tolerance'
                ? { ...evaluation, status: 'verified' as const, failure: null }
                : evaluation;
        },
    };
});

// A committed batch builds a live strip and its devices on this context, whose stubbed params
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
    // The wide recipes' devices build more node kinds than the test context offers: any it lacks is
    // an inert node whose every other property is an inert param.
    const createInertNode = (): unknown =>
        new Proxy(createNode(), {
            get: (node: Record<string | symbol, unknown>, key) => (key in node ? node[key] : createAudioParam(0)),
        });
    const withInertNodes = (context: AudioContext): AudioContext =>
        new Proxy(context, {
            get: (target, key) => {
                const value: unknown = Reflect.get(target, key, target);
                if (typeof value === 'function') {
                    return (value as (...args: unknown[]) => unknown).bind(target);
                }
                return value === undefined && typeof key === 'string' && key.startsWith('create')
                    ? createInertNode
                    : value;
            },
        });
    function AudioContextWithDeviceNodes(options?: AudioContextOptions): AudioContext {
        const context = new OriginalAudioContext(options);
        return withInertNodes(
            Object.assign(context, {
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
            })
        );
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

/** Two dozen tracks render real buffers through the real measurement path, which takes longer than a unit case. */
const REAL_PROJECT_TIMEOUT_MS = 60_000;

/**
 * The batches the whole-run case drives. Each batch preview adds its verification receipts to the run
 * plan, and the run store keeps at most 256 entries in any collection, so the next preview after these
 * takes the plan past it and the store refuses the run.
 */
const BATCHES_WITHIN_RECEIPT_COLLECTION = 5;

/** The acoustic guitar rests through the intro. */
const RESTING_ID = 'track-acoustic';
const INTRO = SECTIONS[0]!;

function renderSong(input: VibeRenderInput): AudioBuffer {
    return renderVibeTimeline(input, (seconds) =>
        input.targetTrackId === RESTING_ID && seconds < INTRO.endBeat * SECONDS_PER_BEAT ? 0 : 1
    );
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'ordinary-size vibe run test',
        tracks: TRACKS.map((spec) => vibeTrack(spec, SONG_BEATS)),
        sections: SECTIONS,
    });
    registerHandlerMap(getProjectHandlers());
    prepareVibeRunEngine();
    seedVibeBrief(TRACKS);
    vi.mocked(generateToolPlanningOutcome).mockReset();
    runtimeMocks.backend.value = 'cloud';
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input) => renderSong(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped run must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A run must be measured on its rendered scope, never on source audio.');
    });
});

afterEach(() => {
    admission.admitsOutOfTolerance = false;
    releaseVibeRunEngine(TRACKS);
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    resetMetricGoalProject();
    vi.restoreAllMocks();
});

describe('a whole-project vibe run on a song of ordinary size', () => {
    it(
        'schedules every plannable track into a batch under the default resource limits',
        async () => {
            scriptVibeBriefRoute({ descriptors: ['warm', 'wide'] });

            await sendVibeMessage('make this mix warmer and wider', (prompt) => sendChatMessage(prompt));

            const brief = requireOnlyProposedVibeCard();
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            expect(vibeCardContent(brief)).not.toContain('No batches were scheduled');
            if (schedule?.kind !== 'vibe-run') {
                throw new Error(`Expected a scheduled vibe run: ${vibeCardContent(brief)}`);
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            const batched = new Set(plan?.batches.flatMap((batch) => batch.targetIds));
            expect(batched).toEqual(new Set(TRACKS.map((track) => track.id)));
            expect(plan?.batches.some((batch) => batch.targets.some((target) => target.recipeIds.length > 1))).toBe(
                true
            );
            // One render per track covers the arrangement and every section.
            expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(TRACKS.length);
        },
        REAL_PROJECT_TIMEOUT_MS
    );

    it(
        'admits the initial figures and the first batch preview within the verification-receipt allowance',
        async () => {
            scriptVibeBriefRoute({ descriptors: ['warm', 'wide'] });
            await sendVibeMessage('make this mix warmer and wider', (prompt) => sendChatMessage(prompt));
            const brief = requireOnlyProposedVibeCard();
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });

            const card = requireOnlyProposedVibeCard();
            expect(card.approvalSnapshot.batchPosition?.index).toBe(2);
            const receipts = agentRunLifecycle.get(brief.runId)?.plan?.applicationToolReceipts ?? [];
            const verification = receipts.filter((receipt) => receipt.origin === 'application-verification');
            const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
            const initial = verification.filter((receipt) => receipt.callId.startsWith('vibe-initial-'));
            const preview = verification.filter((receipt) => receipt.callId.startsWith('goal-measure-'));
            // One receipt per target chunk and exact range: the 24 tracks in six chunks over nine ranges.
            expect(initial).toHaveLength(6 * 9);
            expect(preview.length).toBeGreaterThan(0);
            // Every read was admitted: none was turned into a spent-budget refusal.
            expect(verification.filter((receipt) => receipt.status === 'failure')).toEqual([]);
            // Each collection alone is past what a provider turn may carry, and inside its own allowance.
            for (const collection of [initial, preview]) {
                expect(byteLength(collection)).toBeGreaterThan(
                    APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerTurn
                );
                expect(byteLength(collection)).toBeLessThanOrEqual(
                    APPLICATION_VERIFICATION_RECEIPT_LIMITS.maxBytesPerCollection
                );
            }
            expect(byteLength(receipts)).toBeLessThanOrEqual(APPLICATION_VERIFICATION_RECEIPT_LIMITS.maxTotalBytes);
        },
        REAL_PROJECT_TIMEOUT_MS * 2
    );

    it(
        'proposes each batch with its measured goal state admitted, under the persistence ceiling',
        async () => {
            admission.admitsOutOfTolerance = true;
            scriptVibeBriefRoute({ descriptors: ['warm', 'wide'] });
            await sendVibeMessage('make this mix warmer and wider', (prompt) => sendChatMessage(prompt));
            const brief = requireOnlyProposedVibeCard();
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            if (schedule?.kind !== 'vibe-run') {
                throw new Error(`Expected a scheduled vibe run: ${vibeCardContent(brief)}`);
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            const batchCount = plan?.batches.length ?? 0;
            expect(batchCount).toBeGreaterThan(BATCHES_WITHIN_RECEIPT_COLLECTION);
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });

            const stateBytes: number[] = [];
            for (let position = 2; position <= BATCHES_WITHIN_RECEIPT_COLLECTION + 1; position += 1) {
                const card = requireOnlyProposedVibeCard();
                expect(card.approvalSnapshot.batchPosition?.index).toBe(position);
                const serialized = card.approvalSnapshot.metricGoalState ?? '';
                stateBytes.push(new TextEncoder().encode(serialized).byteLength);
                // Admitted: the persisted state decodes, and its proofs answer the criteria with figures up to
                // the first one outside its tolerance, where the evaluation stops.
                const state = metricGoalStateCodec(serialized);
                expect(state?.authorities.map((authority) => authority.origin)).toEqual(['vibe-run-plan']);
                expect(state?.proofs.length).toBeGreaterThan(0);
                const evaluation = evaluateMetricGoalAdmission({
                    state,
                    commandBatch: card.approvalSnapshot.commandBatch!,
                });
                expect(evaluation.status).toBe('verified');
                await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                    status: 'executed',
                });
            }

            const largest = Math.max(...stateBytes);
            // A batch's proofs outgrow the old 64 KiB ceiling, and each batch stays under the one that bounds it now.
            expect(largest).toBeGreaterThan(65_536);
            expect(largest).toBeLessThanOrEqual(MAX_METRIC_GOAL_STATE_BYTES);
        },
        REAL_PROJECT_TIMEOUT_MS * 8
    );
});
