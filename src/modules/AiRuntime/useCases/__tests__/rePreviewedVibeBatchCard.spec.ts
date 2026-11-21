import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import {
    DRUMS_ID,
    PROMPT,
    VOCAL_ID,
    cardContent,
    renderTrack,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    sendChatMessage,
    tearDownVibeRunFixture,
    type Confirmation,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import {
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { bindMeasuredPreviewToBatch } from '../bindMeasuredPreviewToBatch';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME } from '../vibeRun/buildVibeBatchValueRequest';

import { armValueWire, drumsChoice, scriptBriefRoute, type Reply, type WireAnswer } from './hostedValueChoiceWire';
import { landProjectEdit } from './landProjectEdit';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * A re-preview of a vibe batch card measures the refreshed batch and recomposes the card from that
 * measurement. The hosted provider is scripted at the wire, as in `vibeBatchValueChoice.spec.ts`.
 */
const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));
const planning = vi.hoisted(() => ({
    original: null as null | typeof import('../llmOrchestration/inference').generateToolPlanningOutcome,
}));
const wire = vi.hoisted(() => ({
    requestAnthropic: vi.fn<WireAnswer>(),
    requestOpenAi: vi.fn<WireAnswer>(),
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));
vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../repositories/cloudLlm/usesStrictCloudToolSchemas', () => ({ usesStrictCloudToolSchemas: () => false }));
vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'anthropic', model: 'claude-test', baseUrl: 'https://api.anthropic.com' }),
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderRuntime', () => {
    // One object: a preview compares the runtime by identity to see the configuration held.
    const runtime = {
        provider: 'anthropic',
        authentication: 'api-key',
        model: 'claude-test',
        session_id: `provider-session-${'0'.repeat(32)}`,
    } as const;
    return { getCloudProviderRuntime: () => runtime };
});
vi.mock('../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: wire.requestAnthropic,
}));
vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../llmOrchestration/inference')>();
    planning.original = actual.generateToolPlanningOutcome;
    return {
        ...actual,
        generateToolPlanningOutcome: vi.fn(async () => {
            throw new Error('Unscripted provider planning request.');
        }),
    };
});

// A committed batch builds a live strip and its EQ filters on this context, as the skip spec stubs it.
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
    const createNode = () => ({ connect: (destination: unknown) => destination, disconnect: () => undefined });
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

/** What the scripted provider answers to each value request it reads. */
let respond: () => Reply = () => ({ calls: [] });
let valueBodies: Record<string, unknown>[] = [];

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
    valueBodies = [];
    respond = () => drumsChoice();
    armValueWire(
        wire,
        () => 'anthropic',
        (body) => {
            valueBodies.push(body);
            return respond();
        }
    );
});

afterEach(() => {
    tearDownVibeRunFixture();
});

async function planRun(): Promise<Confirmation> {
    scriptBriefRoute(planning.original);
    await sendChatMessage(PROMPT);
    return requireOnlyProposedCard();
}

async function confirm(card: Confirmation): Promise<void> {
    await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
}

describe('a re-previewed vibe batch card (#6551, #6629)', () => {
    const RE_PREVIEWED = 'Re-previewed against the current project.';

    /** The card's own lines: past its action list and before the approval lines every card ends on. */
    function cardLines(card: Confirmation): string[] {
        const all = cardContent(card)
            .split('\n')
            .filter((line) => line.trim() !== '');
        return all.slice(
            all.findIndex((line) => line.startsWith('Affected IDs: ')) + 1,
            all.findIndex((line) => line.startsWith('Approval risk: '))
        );
    }

    /** The latest of the card's metric-goal proofs bound to its own batch: the one preview a claim may read. */
    function latestBoundProof(card: Confirmation) {
        const batch = card.approvalSnapshot.commandBatch;
        const parsed = batch && parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed?.status !== 'valid') {
            throw new TypeError('Expected the card to hold its batch');
        }
        const proofs = metricGoalStateCodec(card.approvalSnapshot.metricGoalState)?.proofs ?? [];
        return proofs.flatMap((proof) => bindMeasuredPreviewToBatch(proof.preview, parsed.envelope) ?? []).at(-1);
    }

    /** Leaves the card as a snapshot proposed before the value choice was recorded on it. */
    function forgetValueChoice(confirmationId: string): void {
        const state = pendingActionConfirmationStore.value;
        if (state === null) {
            throw new TypeError('Expected the pending confirmations');
        }
        pendingActionConfirmationStore.set({
            ...state,
            confirmations: state.confirmations.map((confirmation) => {
                if (confirmation.id !== confirmationId) {
                    return confirmation;
                }
                const { vibeValueChoice: _recorded, ...snapshot } = confirmation.approvalSnapshot;
                return { ...confirmation, approvalSnapshot: snapshot };
            }),
        });
        expect(getPendingActionConfirmation(confirmationId)?.approvalSnapshot.vibeValueChoice).toBeUndefined();
    }

    /**
     * Moves the project on, and has the drums sound brighter than they did when the card was measured,
     * so the fresh measurement reads other figures than the card showed.
     */
    function brightenDrumsAfterAnEdit(): void {
        landProjectEdit(() => {
            const state = trackStore.value;
            if (state === null) {
                throw new TypeError('Expected the fixture project');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) =>
                    track.id === VOCAL_ID ? { ...track, name: 'Vocal moved' } : track
                ),
            });
        });
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) =>
            renderTrack({
                ...input,
                renderTracks: input.renderTracks.map((track) => {
                    if (track.id !== DRUMS_ID) {
                        return track;
                    }
                    const brighter = {
                        id: 'brighter-drums',
                        name: 'Brighter',
                        type: 'builtin-eq',
                        bypassed: false,
                        parameterValues: { 'eq-high-gain': 6 },
                    };
                    return { ...track, devices: [...track.devices, brighter] };
                }),
            })
        );
    }

    async function rePreview(card: Confirmation, selectedIntentGroupIds?: string[]): Promise<Confirmation> {
        await expect(
            reproposePendingChatActions({ confirmationId: card.id, selectedIntentGroupIds })
        ).resolves.toMatchObject({ status: 'reproposed' });
        return requireOnlyProposedCard();
    }

    async function proposeDrumsCard(script: typeof respond): Promise<Confirmation> {
        respond = script;
        const brief = await planRun();
        await confirm(brief);
        return requireOnlyProposedCard();
    }

    // Red when the re-preview replaces the card's own lines with the bare re-preview sentence, or
    // shows the figures the old measurement read rather than the fresh ones.
    it.each<[string, typeof respond, string[], string[]]>([
        [
            'measurements',
            () => drumsChoice(),
            ['Recipe: Shell weight lifted, cymbal shelf eased on Drums — values chosen from measurements.'],
            [
                'Fresh approval preview on Drums, arrangement [0, 4]: frequency-band energy (bass) 0.5 → 0.76 (verified).',
                'Fresh approval preview on Drums, arrangement [0, 4]: spectral centroid 1509.09 Hz → 1106.29 Hz (verified).',
            ],
        ],
        [
            'catalogue defaults',
            () => ({
                calls: [{ name: VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME, arguments: { reason: 'Already warm.' } }],
            }),
            [
                'Recipe: Shell weight lifted, cymbal shelf eased on Drums — catalogue defaults.',
                'Recipe values are catalogue defaults: the hosted provider declined to choose values (Already warm).',
            ],
            [
                'Fresh approval preview on Drums, arrangement [0, 4]: frequency-band energy (bass) 0.5 → 0.76 (verified).',
                'Fresh approval preview on Drums, arrangement [0, 4]: spectral centroid 1509.09 Hz → 1106.28 Hz (verified).',
            ],
        ],
    ])('recomposes its %s card from the fresh measurement', async (_case, script, recipeLines, freshFigures) => {
        const card = await proposeDrumsCard(script);
        brightenDrumsAfterAnEdit();

        const replacement = await rePreview(card);

        expect(cardLines(replacement)).toEqual([
            'Objective: warm drums.',
            ...recipeLines,
            'Expected on Drums: frequency-band energy (bass) rises; spectral centroid falls.',
            ...freshFigures,
            RE_PREVIEWED,
        ]);
        expect(valueBodies).toHaveLength(1);
        expect(replacement.approvalSnapshot.vibeValueChoice).toEqual(card.approvalSnapshot.vibeValueChoice);
        expect(getAgentApprovalView({ confirmationId: replacement.id })?.measuredPreview).toBeNull();
    });

    // Red when a subset keeps recipe lines it no longer claims, or shows no fresh figures at all.
    it('re-previews a subset as an ordinary card with its own fresh measurement', async () => {
        const card = await proposeDrumsCard(() => drumsChoice());
        const lowGain = getAgentApprovalView({ confirmationId: card.id })?.intentGroups.find((group) =>
            group.summary.includes('(eq-low-gain)')
        );
        if (lowGain === undefined) {
            throw new TypeError('Expected the card to offer its low-gain write as an intent group');
        }
        brightenDrumsAfterAnEdit();

        const replacement = await rePreview(card, [lowGain.id]);

        expect(replacement.actions.map((action) => action.type)).toEqual(['addDevice', 'setDeviceParameter']);
        expect(cardLines(replacement)).toEqual([RE_PREVIEWED]);
        expect(replacement.approvalSnapshot.adoptedRecipes).toBeUndefined();
        expect(replacement.approvalSnapshot.vibeValueChoice).toBeUndefined();
        const preview = replacement.approvalSnapshot.measuredPreview;
        expect(preview?.revision).toBe(captureProjectRevision());
        expect(preview).toEqual(latestBoundProof(replacement));
        const centroid = getAgentApprovalView({ confirmationId: replacement.id })
            ?.measuredPreview?.targets.find((target) => target.targetId === DRUMS_ID)
            ?.metrics.find((metric) => metric.metricId === 'spectralCentroid');
        expect(centroid?.baseline?.value).toBeCloseTo(1509.09, 2);
        expect(centroid?.preview?.value).toBeCloseTo(1222.59, 2);
    });

    // Red when a card proposed before snapshots recorded the value choice no longer re-previews.
    it('re-previews a card whose snapshot recorded no value choice as an ordinary card', async () => {
        const card = await proposeDrumsCard(() => drumsChoice());
        forgetValueChoice(card.id);
        brightenDrumsAfterAnEdit();

        const replacement = await rePreview(card);

        expect(cardLines(replacement)).toEqual([RE_PREVIEWED]);
        expect(replacement.approvalSnapshot.vibeValueChoice).toBeUndefined();
        expect(replacement.approvalSnapshot.measuredPreview?.revision).toBe(captureProjectRevision());
        expect(replacement.approvalSnapshot.measuredPreview).toEqual(latestBoundProof(replacement));
    });
});
