import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import {
    VOCAL_ID,
    proposedCards,
    renderTrack,
    resetVibeRunFixture,
    sendChatMessage,
    tearDownVibeRunFixture,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { appendChatMessage } from '../../stores/chatStore';
import { proposeAnswerSuggestion } from '../aiPanelActions/proposeAnswerSuggestion';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';

import { landProjectEdit } from './landProjectEdit';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * AC-003 of #4372: a whole-project request plans a measured run of recipe batches behind its brief.
 * The brief is confirmed first; each batch is then grounded at the revision the batch before it left,
 * previewed and measured, and approved on its own, and the run stops cleanly on a reject or a refusal.
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

const BGV_ID = 'track-bgv';
const PRESET_RECIPE = 'preset:fx-eq-high-cut:warm';

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
});

afterEach(() => {
    tearDownVibeRunFixture();
});

function suggest(recipeId: string, targetId = VOCAL_ID) {
    const messageId = `answer-${recipeId}-${targetId}`;
    appendChatMessage({
        id: messageId,
        role: 'assistant',
        content: 'An answer offering one recipe.',
        timestamp: Date.now(),
        projectId: captureProjectIdentity(),
        projectRevision: captureProjectRevision(),
        answerSuggestion: {
            recipeId,
            recipeTitle: recipeId,
            targetId,
            targetName: targetId,
            recipeRole: 'vocal',
            roleSource: 'argument',
        },
    });
    return proposeAnswerSuggestion(messageId);
}

function onlyCard() {
    const cards = proposedCards();
    if (cards.length !== 1 || cards[0] === undefined) {
        throw new TypeError(`Expected one proposed card, found ${String(cards.length)}`);
    }
    return cards[0];
}

function goalState(card: ReturnType<typeof onlyCard>): MetricGoalState {
    const state = metricGoalStateCodec(card.approvalSnapshot.metricGoalState);
    if (state === null) {
        throw new TypeError('Expected the card to carry a readable metric goal state');
    }
    return state;
}

function addBackingVocals(): void {
    landProjectEdit(() => {
        const state = trackStore.value;
        if (state === null) {
            throw new TypeError('Expected project tracks');
        }
        const bgv = createTrack({ id: BGV_ID, name: 'BGV', kind: 'audio' });
        const vocal = state.tracks.find((track) => track.id === VOCAL_ID);
        trackStore.set({
            ...state,
            tracks: [
                ...state.tracks,
                {
                    ...bgv,
                    clips: (vocal?.clips ?? []).map((clip) => ({ ...clip, id: `${BGV_ID}-clip`, trackId: BGV_ID })),
                },
            ],
        });
    });
}

/** A renderer that moves every figure the way the recipe says it must not: the shelves act inverted. */
function renderAgainstRecipe(input: RenderInput): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    return renderTrack({
        ...input,
        renderTracks: input.renderTracks.map((candidate) => ({
            ...candidate,
            devices: candidate.devices.map((device) => ({
                ...device,
                parameterValues: Object.fromEntries(
                    Object.entries(device.parameterValues).map(([id, value]) => [
                        id,
                        id.endsWith('-gain') ? -value : value,
                    ])
                ),
            })),
        })),
    });
}

describe("an adopted recipe proposal is verified against the recipe's own expectations (AC-004 of #4369)", () => {
    it("freezes an authored recipe suggestion's expectations as goals and verifies the measured preview", async () => {
        await expect(suggest('vocal-warm')).resolves.toBe('requested');

        const card = onlyCard();
        const state = goalState(card);
        const [authority] = state.authorities;
        expect(authority).toMatchObject({ origin: 'answer-suggestion', kind: 'perceptual' });
        expect(authority?.goals.map((goal) => goal.source)).toEqual([
            expect.objectContaining({ kind: 'recipe', recipeId: 'vocal-warm', expectationIndex: 0 }),
            expect.objectContaining({ kind: 'recipe', recipeId: 'vocal-warm', expectationIndex: 1 }),
        ]);
        expect(state.binding).toMatchObject({ revision: card.projectRevision });
        expect(state.proofs.length).toBeGreaterThan(0);
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalled();
        const view = getAgentApprovalView({ confirmationId: card.id });
        expect(view?.metricGoals.status).toBe('verified');
        expect(view?.canConfirm).toBe(true);
    });

    it('shows the card with Confirm blocked when the measured preview moves against the recipe', async () => {
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => renderAgainstRecipe(input));

        await suggest('vocal-warm');

        const card = onlyCard();
        const view = getAgentApprovalView({ confirmationId: card.id });
        expect(view?.metricGoals.status).toBe('blocked');
        expect(view?.metricGoals.failure).toBe('out-of-tolerance');
        expect(view?.canConfirm).toBe(false);
    });

    it('shows the card with Confirm blocked when the preview cannot be measured', async () => {
        audio.renderTrackSubgraphOffline.mockImplementation(async () => {
            throw new Error('The renderer is unavailable.');
        });

        await suggest('vocal-warm');

        const view = getAgentApprovalView({ confirmationId: onlyCard().id });
        expect(view?.metricGoals.status).toBe('blocked');
        expect(view?.canConfirm).toBe(false);
    });

    it("freezes the same goals when the last commit's recipe is repeated on another track", async () => {
        addBackingVocals();
        await suggest('vocal-warm');
        await expect(confirmPendingChatActions({ confirmationId: onlyCard().id })).resolves.toEqual({
            status: 'executed',
        });

        await sendChatMessage('do the same to the BGV');

        const card = onlyCard();
        const state = goalState(card);
        const [authority] = state.authorities;
        expect(authority).toMatchObject({ origin: 'last-commit-recipe', kind: 'perceptual' });
        expect(authority?.goals.map((goal) => [goal.targetIds, goal.source.kind])).toEqual([
            [[BGV_ID], 'recipe'],
            [[BGV_ID], 'recipe'],
        ]);
        expect(state.proofs.length).toBeGreaterThan(0);
        expect(getAgentApprovalView({ confirmationId: card.id })?.metricGoals.status).toBe('verified');
    });

    it('keeps a preset-only adopted batch literal, with no goals and nothing measured', async () => {
        await suggest(PRESET_RECIPE);

        const card = onlyCard();
        const [authority] = goalState(card).authorities;
        expect(authority).toMatchObject({ origin: 'answer-suggestion', kind: 'literal', goals: [] });
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(getAgentApprovalView({ confirmationId: card.id })?.metricGoals.status).toBe('not-required');
    });
});
