import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { removeTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    DRUMS_ID,
    briefIntake,
    proposeBrief,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    scriptPlanningTurns,
    sendChatMessage,
    tearDownVibeRunFixture,
    type Confirmation,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';

import { landProjectEdit } from './landProjectEdit';
import { metricGoalAudioBuffer } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * A vibe run stacks every requested character's recipe on one target in one batch, and admission
 * holds each recipe's goal across the whole batch as well as across its own step. "Warm the mix up
 * and clean out the mud" puts drums-warm and then drums-muddy on the drums: the warm lift raises the
 * kit's level more than the mud cut lowers it, so only a goal that measures mud itself, the low-mid
 * band, can hold from the first figure to the last.
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

const GUITAR_ID = 'track-guitar';
const SAMPLE_RATE = 48_000;

/** A kit's body, its boxy low-mid and its attack, in hertz and linear amplitude. */
const KIT_PARTIALS = [
    { hertz: 100, amplitude: 0.4 },
    { hertz: 375, amplitude: 0.2 },
    { hertz: 3000, amplitude: 0.2 },
] as const;

/** The built-in EQ's three bands and the values a band holds when a device leaves it unset. */
const EQ_BANDS = [
    { band: 'low', frequency: 100 },
    { band: 'mid', frequency: 1000 },
    { band: 'high', frequency: 8000 },
] as const;

type DeviceParameters = Readonly<Record<string, number>>;

/**
 * The magnitude of one Web Audio `peaking` biquad at `hertz`, from the Audio EQ Cookbook
 * coefficients the Web Audio specification states. The built-in EQ chains three of them.
 */
function peakingMagnitude(input: { centre: number; q: number; gainDb: number; hertz: number }): number {
    const a = 10 ** (input.gainDb / 40);
    const w0 = (2 * Math.PI * input.centre) / SAMPLE_RATE;
    const alpha = Math.sin(w0) / (2 * input.q);
    const cos = Math.cos(w0);
    const numerator = [1 + alpha * a, -2 * cos, 1 - alpha * a];
    const denominator = [1 + alpha / a, -2 * cos, 1 - alpha / a];
    const w = (2 * Math.PI * input.hertz) / SAMPLE_RATE;
    const response = (taps: readonly number[]) => {
        const real = taps.reduce((sum, tap, index) => sum + tap * Math.cos(index * w), 0);
        const imaginary = taps.reduce((sum, tap, index) => sum - tap * Math.sin(index * w), 0);
        return Math.hypot(real, imaginary);
    };
    return response(numerator) / response(denominator);
}

/** How much one built-in EQ scales a partial, with its mid band's gain read through `midGainSign`. */
function eqMagnitude(parameters: DeviceParameters, hertz: number, midGainSign: number): number {
    return EQ_BANDS.reduce((product, { band, frequency }) => {
        const gain = parameters[`eq-${band}-gain`] ?? 0;
        return (
            product *
            peakingMagnitude({
                centre: parameters[`eq-${band}-freq`] ?? frequency,
                q: parameters[`eq-${band}-q`] ?? 1,
                gainDb: band === 'mid' ? midGainSign * gain : gain,
                hertz,
            })
        );
    }, 1);
}

/**
 * Every track sounds the kit's three partials, each scaled by the steady-state response of every EQ
 * the track carries, as the offline renderer's biquads would scale a sustained tone.
 */
function renderThroughEq(input: RenderInput, midGainSign: number): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const eqs = track.devices.filter((device) => device.type === 'builtin-eq');
    const partials = KIT_PARTIALS.map(({ hertz, amplitude }) => ({
        hertz,
        amplitude: eqs.reduce<number>(
            (scaled, device) => scaled * eqMagnitude(device.parameterValues, hertz, midGainSign),
            amplitude
        ),
    }));
    return metricGoalAudioBuffer(
        (time) =>
            partials.reduce<number>(
                (sum, { hertz, amplitude }) => sum + amplitude * Math.sin(2 * Math.PI * hertz * time),
                0
            ),
        (input.endBeat - input.startBeat) / 2,
        SAMPLE_RATE
    );
}

function useEqRenderer(midGainSign: number): void {
    audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) =>
        renderThroughEq(input, midGainSign)
    );
}

function addGuitar(): void {
    landProjectEdit(() => {
        const state = trackStore.value;
        if (state === null) {
            throw new Error('Missing tracks.');
        }
        const guitar = createTrack({ id: GUITAR_ID, name: 'Guitar', kind: 'audio' });
        const take = state.tracks[0]?.clips[0];
        if (take === undefined) {
            throw new Error('Missing the fixture take.');
        }
        trackStore.set({
            ...state,
            tracks: [
                ...state.tracks,
                {
                    ...guitar,
                    clips: [
                        { ...take, id: `${GUITAR_ID}-clip`, trackId: GUITAR_ID, audioBufferId: `${GUITAR_ID}-buffer` },
                    ],
                },
            ],
        });
    });
}

/** Plans the request on the hosted chain, then confirms its brief on the local chain. */
async function proposeDrums(prompt: string, requestedDescriptors: readonly string[]): Promise<Confirmation> {
    scriptPlanningTurns([
        briefIntake,
        () => [
            {
                id: 'brief-compile',
                name: 'brief.compile',
                arguments: {
                    vision: 'A chosen sound',
                    mixIntent: {
                        catalogId: getBriefMixIntentCatalog().catalogId,
                        requestedDescriptors: [...requestedDescriptors],
                    },
                },
            },
        ],
        proposeBrief,
    ]);
    await sendChatMessage(prompt);
    const brief = requireOnlyProposedCard();
    runtimeMocks.backend.value = 'webllm';
    await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
    const drums = requireOnlyProposedCard();
    expect(drums.approvalSnapshot.batchPosition?.index).toBe(2);
    expect(drums.approvalSnapshot.adoptedRecipes?.map((recipe) => recipe.targetId)).toEqual(
        requestedDescriptors.map(() => DRUMS_ID)
    );
    return drums;
}

function lowMidCriteria(card: Confirmation) {
    return (
        getAgentApprovalView({ confirmationId: card.id })?.metricGoals.criteria.filter(
            (criterion) =>
                criterion.metricId === 'frequencyBandEnergy' &&
                criterion.band === 'low-mid' &&
                criterion.targetIds.includes(DRUMS_ID)
        ) ?? []
    );
}

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
    addGuitar();
});

afterEach(() => {
    removeTrackStrip(GUITAR_ID);
    tearDownVibeRunFixture();
});

describe('a vibe batch stacking two recipes on one target', () => {
    // Red when a stacked recipe claims a figure the other recipe's move outweighs, so the batch can
    // never verify from its first figure to its last.
    it('verifies warm and then muddy on the drums', async () => {
        useEqRenderer(1);
        const drums = await proposeDrums('warm the mix up and clean out the mud, but don’t make the Guitar louder', [
            'warm',
            'muddy',
        ]);

        expect(drums.approvalSnapshot.adoptedRecipes?.map((recipe) => recipe.recipeId)).toEqual([
            'drums-warm',
            'drums-muddy',
        ]);
        const view = getAgentApprovalView({ confirmationId: drums.id });
        expect(
            view?.metricGoals.criteria
                .filter((criterion) => criterion.status === 'blocked')
                .map(({ stepId, metricId, band, baseline, observed }) => ({
                    stepId,
                    metricId,
                    band,
                    baseline,
                    observed,
                }))
        ).toEqual([]);
        expect(view?.metricGoals.status).toBe('verified');
        expect(view?.canConfirm).toBe(true);
        expect(lowMidCriteria(drums).length).toBeGreaterThan(0);
    });

    // Red when the mud recipe stops claiming the low-mid band, or its cut stops lowering it.
    it('verifies muddy alone and lowers the drums’ low-mid band', async () => {
        useEqRenderer(1);
        const drums = await proposeDrums('clean out the mud', ['muddy']);

        expect(getAgentApprovalView({ confirmationId: drums.id })?.metricGoals.status).toBe('verified');
        const criteria = lowMidCriteria(drums);
        expect(criteria.length).toBeGreaterThan(0);
        for (const criterion of criteria) {
            expect(criterion.status).toBe('verified');
            expect(criterion.observed[0]).toBeLessThan(criterion.baseline[0] ?? Number.NEGATIVE_INFINITY);
        }
    });

    // Red when admission verifies a batch whose preview moves the mud the wrong way.
    it('blocks muddy when its preview raises the low-mid band', async () => {
        useEqRenderer(-1);
        const drums = await proposeDrums('clean out the mud', ['muddy']);

        const view = getAgentApprovalView({ confirmationId: drums.id });
        expect(view?.metricGoals.status).toBe('blocked');
        expect(view?.metricGoals.reason).toBe(
            'Actual preview measurements do not satisfy the frozen objective criterion.'
        );
        expect(view?.canConfirm).toBe(false);
        expect(lowMidCriteria(drums).some((criterion) => criterion.status === 'blocked')).toBe(true);
    });
});
