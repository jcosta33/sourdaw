import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { chatStore } from '../../stores/chatStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { sendChatMessage } from '../sendChatMessage';
import { countVibeRunCandidateBatches } from '../vibeRun/countVibeRunCandidateBatches';

import { configureMetricGoalProject, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import {
    prepareVibeRunEngine,
    proposedVibeCards,
    releaseVibeRunEngine,
    renderVibeTimeline,
    requireOnlyProposedVibeCard,
    scriptVibeBriefRoute,
    seedVibeBrief,
    sendVibeMessage,
    VIBE_TEMPO,
    vibeCardContent,
    vibeSections,
    vibeTrack,
} from './vibeRunProjectFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * A whole-project vibe run keeps out every track of a role family the request excludes: the
 * exclusion reaches the run through the one explicit-protection reader, so no batch touches a drum
 * track the user told the agent not to touch. No track carries an authored role: each one's role is
 * the one the context producer derives from its name and kind.
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
 * Whether the fixture's figures move the way each recipe expects is not what this case observes, so
 * it admits a batch whose first failing criterion read and compared its figures but fell outside
 * its tolerance; a missing, incomparable or stale figure still blocks it.
 */
const admission = vi.hoisted(() => ({ admitsOutOfTolerance: false }));
vi.mock('../evaluateMetricGoalAdmission', async (importOriginal) => {
    const original = await importOriginal<typeof import('../evaluateMetricGoalAdmission')>();
    return {
        ...original,
        evaluateMetricGoalAdmission: (input: Parameters<typeof original.evaluateMetricGoalAdmission>[0]) => {
            const evaluation = original.evaluateMetricGoalAdmission(input);
            if (admission.admitsOutOfTolerance && evaluation.failure === 'out-of-tolerance') {
                return { ...evaluation, status: 'verified' as const, failure: null };
            }
            return evaluation;
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
    // an inert node whose every other property is an inert member.
    // An inert member serves as either an AudioParam (`frequency.value`) or a method (`start()`).
    const createInertMember = () => Object.assign(() => undefined, createAudioParam(0));
    const createInertNode = (): unknown =>
        new Proxy(createNode(), {
            get: (node: Record<string | symbol, unknown>, key) => (key in node ? node[key] : createInertMember()),
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

const SECTIONS = vibeSections(['Verse', 'Chorus'], 8);
const SONG_BEATS = 16;
const TRACKS = [
    { id: 'track-kick', name: 'Kick', role: 'kick' },
    { id: 'track-snare', name: 'Snare', role: 'snare' },
    { id: 'track-hi-hat', name: 'Hi-Hat', role: 'hi-hat' },
    { id: 'track-overheads', name: 'Overheads', role: 'overhead' },
    { id: 'track-vocals', name: 'Vocals', role: 'lead vocal' },
    { id: 'track-bass', name: 'Bass', role: 'bass' },
    { id: 'track-guitar', name: 'Guitar', role: 'guitar' },
    { id: 'track-keys', name: 'Keys', role: 'keys' },
    { id: 'track-music-bus', name: 'Music Bus', role: 'bus' },
    // No canonical role: only a brief that assigns one places it in a family.
    { id: 'track-parallel-crush', name: 'Parallel Crush', role: 'unknown' },
];
const DRUM_IDS = ['track-kick', 'track-snare', 'track-hi-hat', 'track-overheads'];
const DRUM_NAMES = ['Kick', 'Snare', 'Hi-Hat', 'Overheads'];
const CRUSH_ID = 'track-parallel-crush';
/** A whole song of tracks renders through the real measurement path, which takes longer than a unit case. */
const RUN_TIMEOUT_MS = 120_000;

function projectTracks() {
    return TRACKS.map((spec) => {
        const track = vibeTrack(spec, SONG_BEATS);
        return spec.role === 'bus' ? { ...track, kind: 'bus' as const, clips: [] } : track;
    });
}

function trackBytes(ids: readonly string[]): string {
    return JSON.stringify(trackStore.value?.tracks.filter((track) => ids.includes(track.id)));
}

function drumTrackBytes(): string {
    return trackBytes(DRUM_IDS);
}

beforeEach(() => {
    configureMetricGoalProject({
        label: 'role family exclusion vibe run test',
        tempo: VIBE_TEMPO,
        tracks: projectTracks(),
        sections: SECTIONS,
    });
    registerHandlerMap(getProjectHandlers());
    prepareVibeRunEngine();
    seedVibeBrief();
    vi.mocked(generateToolPlanningOutcome).mockReset();
    runtimeMocks.backend.value = 'cloud';
    audio.renderTrackSubgraphOffline
        .mockReset()
        .mockImplementation(async (input) => renderVibeTimeline(input, () => 1));
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

describe('a vibe run whose request excludes a role family', () => {
    it('owns the drum tracks in the protected scope, so a proposal omitting them is refused', async () => {
        scriptVibeBriefRoute({ descriptors: ['warm'] });
        await sendVibeMessage("make the mix warmer, but don't touch the drums", (prompt) => sendChatMessage(prompt));

        expect(proposedVibeCards()).toEqual([]);
        expect(chatStore.value?.messages.at(-1)?.error).toBe(
            'Provider attempted to enlarge or omit the application-owned scope.'
        );
    });

    it(
        'schedules no batch touching a drum track and leaves every drum track byte-identical',
        async () => {
            admission.admitsOutOfTolerance = true;
            scriptVibeBriefRoute({ descriptors: ['warm'], protectedTargetIds: DRUM_IDS });
            await sendVibeMessage("make the mix warmer, but don't touch the drums", (prompt) =>
                sendChatMessage(prompt)
            );

            const brief = requireOnlyProposedVibeCard();
            const content = vibeCardContent(brief);
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            if (schedule?.kind !== 'vibe-run') {
                throw new Error(`Expected a scheduled vibe run: ${content}`);
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            const batched = plan?.batches.flatMap((batch) => batch.targetIds) ?? [];
            expect(batched.length).toBeGreaterThan(0);
            expect(batched.filter((id) => DRUM_IDS.includes(id))).toEqual([]);
            for (const name of DRUM_NAMES) {
                expect(content).toContain(`Not planned: ${name}, because the request or brief protects it.`);
            }
            // The brief carries the exclusion as its protected objects, and its card says so.
            expect(brief.protectedUnchanged.map((object) => object.id)).toEqual(expect.arrayContaining(DRUM_IDS));
            const protectedLine = content.split('\n').find((line) => line.startsWith('Protected unchanged: '));
            for (const [index, name] of DRUM_NAMES.entries()) {
                expect(protectedLine).toContain(`"${name}" (${DRUM_IDS[index] ?? ''})`);
            }

            const before = drumTrackBytes();
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });
            const batchCount = plan?.batches.length ?? 0;
            for (let position = 2; position <= batchCount + 1; position += 1) {
                const card = requireOnlyProposedVibeCard();
                expect(card.approvalSnapshot.batchPosition?.index).toBe(position);
                await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                    status: 'executed',
                });
                expect(drumTrackBytes()).toEqual(before);
            }

            expect(proposedVibeCards()).toEqual([]);
            expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
        },
        RUN_TIMEOUT_MS
    );

    it('counts no candidate batch for a track the brief places in a family the request protects', () => {
        const live = getProjectContext();
        const brief = live.productionBrief;
        if (brief === undefined) {
            throw new Error('Expected the seeded production brief in the project context.');
        }
        const context = { ...live, tracks: live.tracks.filter((track) => track.id === CRUSH_ID) };
        const count = (prompt: string) =>
            countVibeRunCandidateBatches({
                prompt,
                context,
                brief: {
                    ...brief,
                    trackRoles: [{ id: 'role-crush', trackId: CRUSH_ID, role: 'drums', createdAt: 100 }],
                },
                descriptors: ['warm'],
            });

        expect(count('make the mix warmer')).toBe(1);
        expect(count("make the mix warmer, but don't touch the drums")).toBe(0);
    });

    it(
        'protects a track the compiled brief places in the drums family, exactly as the run plans it',
        async () => {
            admission.admitsOutOfTolerance = true;
            const protectedIds = [...DRUM_IDS, CRUSH_ID];
            scriptVibeBriefRoute({
                descriptors: ['warm'],
                protectedTargetIds: protectedIds,
                trackRoles: [{ trackId: CRUSH_ID, role: 'drums' }],
            });
            await sendVibeMessage("make the mix warmer, but don't touch the drums", (prompt) =>
                sendChatMessage(prompt)
            );

            const brief = requireOnlyProposedVibeCard();
            const content = vibeCardContent(brief);
            const schedule = agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule;
            if (schedule?.kind !== 'vibe-run') {
                throw new Error(`Expected a scheduled vibe run: ${content}`);
            }
            const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
            const batched = plan?.batches.flatMap((batch) => batch.targetIds) ?? [];
            expect(batched.length).toBeGreaterThan(0);
            expect(batched.filter((id) => protectedIds.includes(id))).toEqual([]);
            expect(content).toContain('Not planned: Parallel Crush, because the request or brief protects it.');
            expect(brief.protectedUnchanged.map((object) => object.id)).toEqual(expect.arrayContaining(protectedIds));
            const protectedLine = content.split('\n').find((line) => line.startsWith('Protected unchanged: '));
            expect(protectedLine).toContain(`"Parallel Crush" (${CRUSH_ID})`);

            const before = trackBytes(protectedIds);
            await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({
                status: 'executed',
            });
            const batchCount = plan?.batches.length ?? 0;
            for (let position = 2; position <= batchCount + 1; position += 1) {
                const card = requireOnlyProposedVibeCard();
                expect(card.approvalSnapshot.batchPosition?.index).toBe(position);
                expect(card.protectedUnchanged.map((object) => object.id)).toEqual(
                    expect.arrayContaining(protectedIds)
                );
                await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({
                    status: 'executed',
                });
                expect(trackBytes(protectedIds)).toEqual(before);
            }

            expect(proposedVibeCards()).toEqual([]);
            expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('completed');
        },
        RUN_TIMEOUT_MS
    );
});
