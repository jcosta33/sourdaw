import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { containsSampleData } from '../../__tests__/hostedSampleDataDetector';
import {
    BRIEF_ROUTE,
    DRUMS_ID,
    PROMPT,
    VOCAL_ID,
    cardContent,
    editBrief,
    proposedCards,
    renderTrack,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    sendChatMessage,
    tearDownVibeRunFixture,
    type Confirmation,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { encodeWireToolName } from '../../repositories/cloudLlm/cloudInference/encodeWireToolName';
import { chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { skipPendingVibeBatch } from '../skipPendingVibeBatch';
import {
    VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME,
    VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME,
    type VibeBatchValuePair,
} from '../vibeRun/buildVibeBatchValueRequest';
import { readVibeBatchValueReply } from '../vibeRun/readVibeBatchValueReply';

import { landProjectEdit } from './landProjectEdit';
import { metricGoalAudioBuffer } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * On a hosted backend each vibe batch asks the provider once for its recipe values, chosen from the
 * batch targets' measured baselines inside each parameter's authored window; the application reads
 * the reply whole and keeps the catalogue defaults whenever the provider declines, fails or is refused
 * twice. The provider is scripted at the wire, in each dialect's documented reply shape.
 */
type Dialect = 'anthropic' | 'openai' | 'openai-compatible';

const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' }, dialect: { value: 'anthropic' as string } }));
const planning = vi.hoisted(() => ({
    original: null as null | typeof import('../llmOrchestration/inference').generateToolPlanningOutcome,
}));
const wire = vi.hoisted(() => ({
    requestAnthropic: vi.fn(),
    requestOpenAi: vi.fn(),
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
    getCloudProviderInfo: () => {
        switch (runtimeMocks.dialect.value) {
            case 'anthropic':
                return { provider: 'anthropic', model: 'claude-test', baseUrl: 'https://api.anthropic.com' };
            case 'openai':
                return { provider: 'openai', model: 'gpt-test', baseUrl: 'https://api.openai.com/v1' };
            default:
                return { provider: 'openai-compatible', model: 'compatible-test', baseUrl: 'http://localhost:1234/v1' };
        }
    },
}));
vi.mock('../../repositories/cloudLlm/getCloudProviderRuntime', async () => {
    const registry = await import('../../repositories/providerAdapterRegistry');
    // One object per dialect: a preview compares the runtime by identity to see the configuration held.
    const runtimes = {
        anthropic: {
            provider: 'anthropic',
            authentication: 'api-key',
            model: 'claude-test',
            session_id: `provider-session-${'0'.repeat(32)}`,
        },
        openai: {
            provider: 'openai',
            model: 'gpt-test',
            base_url: 'https://api.openai.com/v1',
            authentication: 'api-key',
            adapter: registry.compileProviderAdapterInstallation({
                adapterId: registry.OPENAI_RESPONSES_ADAPTER_ID,
                providerId: 'openai',
                modelId: 'gpt-test',
                protocolFamily: 'openai-responses',
                origin: 'https://api.openai.com',
            }),
            session_id: `provider-session-${'0'.repeat(32)}`,
        },
        compatible: {
            provider: 'openai-compatible',
            authentication: 'none',
            session_id: null,
            model: 'compatible-test',
            base_url: 'http://localhost:1234/v1',
            strict_tool_schemas: false,
        },
    } as const;
    return {
        getCloudProviderRuntime: () => {
            switch (runtimeMocks.dialect.value) {
                case 'anthropic':
                    return runtimes.anthropic;
                case 'openai':
                    return runtimes.openai;
                default:
                    return runtimes.compatible;
            }
        },
    };
});
vi.mock('../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: wire.requestAnthropic,
}));
vi.mock('../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: wire.requestOpenAi,
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

/** The drums-warm window the batch's one recipe authors, and values inside it that no EQ starts at. */
const DRUMS_CHOICE = [
    { step: 0, paramId: 'eq-low-freq', value: 90 },
    { step: 0, paramId: 'eq-low-gain', value: 3.5 },
    { step: 0, paramId: 'eq-high-freq', value: 9000 },
    { step: 0, paramId: 'eq-high-gain', value: -1.5 },
];

type Reply = { calls: ToolCallResult[] } | { text: string } | { status: number };

/** What the scripted provider answers to each value request it reads, by its index among them. */
let respond: (request: { user: Record<string, unknown>; index: number }) => Reply = () => ({ calls: [] });
let valueBodies: Record<string, unknown>[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value request's own JSON user message, wherever the dialect put it. */
function readUserJson(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string' && value.startsWith('{')) {
        try {
            const parsed: unknown = JSON.parse(value);
            if (isRecord(parsed) && (Array.isArray(parsed.pairs) || isRecord(parsed.request))) {
                return parsed;
            }
        } catch {
            return null;
        }
        return null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = readUserJson(item);
            if (found !== null) {
                return found;
            }
        }
    }
    if (isRecord(value)) {
        for (const item of Object.values(value)) {
            const found = readUserJson(item);
            if (found !== null) {
                return found;
            }
        }
    }
    return null;
}

function encodeReply(dialect: string, reply: Reply): { status: number; body: string } {
    if ('status' in reply) {
        return { status: reply.status, body: '{"error":{"message":"overloaded"}}' };
    }
    const usage = { input: 900, output: 120 };
    if (dialect === 'anthropic') {
        const content =
            'text' in reply
                ? [{ type: 'text', text: reply.text }]
                : reply.calls.map((call, index) => ({
                      type: 'tool_use',
                      id: `toolu_${String(index)}`,
                      name: encodeWireToolName(call.name),
                      input: call.arguments,
                  }));
        return {
            status: 200,
            body: JSON.stringify({
                id: 'msg_values',
                type: 'message',
                role: 'assistant',
                content,
                stop_reason: 'text' in reply ? 'end_turn' : 'tool_use',
                usage: { input_tokens: usage.input, output_tokens: usage.output },
            }),
        };
    }
    if (dialect === 'openai') {
        const output =
            'text' in reply
                ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply.text }] }]
                : reply.calls.map((call, index) => ({
                      type: 'function_call',
                      id: `fc_${String(index)}`,
                      call_id: `call_${String(index)}`,
                      name: encodeWireToolName(call.name),
                      arguments: JSON.stringify(call.arguments),
                  }));
        return {
            status: 200,
            body: JSON.stringify({
                id: 'resp_values',
                status: 'completed',
                output,
                usage: { input_tokens: usage.input, output_tokens: usage.output },
            }),
        };
    }
    const message =
        'text' in reply
            ? { role: 'assistant', content: reply.text }
            : {
                  role: 'assistant',
                  content: null,
                  tool_calls: reply.calls.map((call, index) => ({
                      id: `call_${String(index)}`,
                      type: 'function',
                      function: { name: encodeWireToolName(call.name), arguments: JSON.stringify(call.arguments) },
                  })),
              };
    return {
        status: 200,
        body: JSON.stringify({
            id: 'chatcmpl-values',
            choices: [{ index: 0, finish_reason: 'text' in reply ? 'stop' : 'tool_calls', message }],
            usage: { prompt_tokens: usage.input, completion_tokens: usage.output },
        }),
    };
}

function armWire(): void {
    const answer = async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
        const body: unknown = JSON.parse(request.body);
        if (!isRecord(body)) {
            throw new TypeError('Expected a JSON body');
        }
        const user = readUserJson(body);
        if (user === null) {
            throw new Error('A provider request that is not a value request reached the wire.');
        }
        valueBodies.push(body);
        const reply = encodeReply(runtimeMocks.dialect.value, respond({ user, index: valueBodies.length - 1 }));
        request.onBodyChunk(new TextEncoder().encode(reply.body));
        return { status: reply.status, contentType: 'application/json' };
    };
    wire.requestAnthropic.mockReset().mockImplementation(answer);
    wire.requestOpenAi.mockReset().mockImplementation(answer);
}

/** The brief route is scripted; a value request goes through the real hosted route to the wire. */
function scriptRun(): void {
    let briefTurn = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (...args) => {
        const [, userMessage, schemas] = args;
        if (schemas.some((schema: ToolSchema) => schema.function.name === VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME)) {
            const original = planning.original;
            if (original === null) {
                throw new Error('The real planning route was not captured.');
            }
            return original(...args);
        }
        const turn = BRIEF_ROUTE[briefTurn];
        briefTurn += 1;
        if (turn === undefined) {
            throw new Error('Unscripted brief turn');
        }
        return { status: 'complete', toolCalls: turn({ userMessage, schemas }) };
    });
}

async function planRun(): Promise<Confirmation> {
    scriptRun();
    await sendChatMessage(PROMPT);
    return requireOnlyProposedCard();
}

async function confirm(card: Confirmation): Promise<void> {
    await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
}

function choose(pairs: { targetId: string; recipeId: string; values: unknown[] }[]): Reply {
    return { calls: [{ name: VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME, arguments: { choices: pairs } }] };
}

function drumsChoice(values: unknown[] = DRUMS_CHOICE): Reply {
    return choose([{ targetId: DRUMS_ID, recipeId: 'drums-warm', values }]);
}

/** Each parameter write of the card, on the track whose added device it writes. */
function parameterWrites(card: Confirmation) {
    const trackOfDevice = new Map(
        card.actions.flatMap((action) =>
            action.type === 'addDevice' && action.payload.deviceId !== undefined
                ? [[action.payload.deviceId, action.payload.trackId] as const]
                : []
        )
    );
    return card.actions.flatMap((action) =>
        action.type === 'setDeviceParameter'
            ? [
                  {
                      paramId: action.payload.paramId,
                      value: action.payload.value,
                      trackId: trackOfDevice.get(action.payload.deviceId) ?? null,
                  },
              ]
            : []
    );
}

/** The drums-warm window middles; an insert leaves out a write equal to what the new EQ starts at. */
const DRUMS_MIDPOINTS: Record<string, number> = {
    'eq-low-freq': 100,
    'eq-low-gain': 3,
    'eq-high-freq': 10000,
    'eq-high-gain': -2,
};

function expectMidpointWrites(card: Confirmation): void {
    const writes = parameterWrites(card);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
        expect(write).toEqual({ paramId: write.paramId, value: DRUMS_MIDPOINTS[write.paramId], trackId: DRUMS_ID });
    }
}

type WirePair = {
    targetId: string;
    recipeId: string;
    baselines: (Record<string, unknown> & { metric: string; figures: Record<string, unknown> })[];
    parameters: { step: number; paramId: string; catalogueDefault: number }[];
};

/** The pairs a value request lists, read field by field so a reshaped request fails here, not later. */
function readWirePairs(user: Record<string, unknown>): WirePair[] {
    if (!Array.isArray(user.pairs)) {
        throw new TypeError('Expected the value request to list its pairs');
    }
    return user.pairs.map((pair: unknown) => {
        if (
            !isRecord(pair) ||
            typeof pair.targetId !== 'string' ||
            typeof pair.recipeId !== 'string' ||
            !Array.isArray(pair.baselines) ||
            !Array.isArray(pair.parameters)
        ) {
            throw new TypeError('Expected a value request pair');
        }
        const baselines = pair.baselines.map((baseline: unknown) => {
            if (!isRecord(baseline) || typeof baseline.metric !== 'string' || !isRecord(baseline.figures)) {
                throw new TypeError('Expected a baseline with keyed figures');
            }
            return { ...baseline, metric: baseline.metric, figures: baseline.figures };
        });
        const parameters = pair.parameters.map((parameter: unknown) => {
            if (
                !isRecord(parameter) ||
                typeof parameter.step !== 'number' ||
                typeof parameter.paramId !== 'string' ||
                typeof parameter.catalogueDefault !== 'number'
            ) {
                throw new TypeError('Expected a parameter window');
            }
            return { step: parameter.step, paramId: parameter.paramId, catalogueDefault: parameter.catalogueDefault };
        });
        return { targetId: pair.targetId, recipeId: pair.recipeId, baselines, parameters };
    });
}

function userMessageOf(body: Record<string, unknown>): Record<string, unknown> {
    const user = readUserJson(body);
    if (user === null) {
        throw new TypeError('Expected the value request user message');
    }
    return user;
}

function messages(): string[] {
    return (chatStore.value?.messages ?? []).map((message) => message.content);
}

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
    runtimeMocks.dialect.value = 'anthropic';
    valueBodies = [];
    respond = () => drumsChoice();
    armWire();
});

afterEach(() => {
    tearDownVibeRunFixture();
});

describe('hosted value choice for a vibe batch', () => {
    // Red when the batch expands at its window middles instead of the values the reply chose, or when the
    // real request the builder sends on this dialect carries sample data.
    it.each<Dialect>(['anthropic', 'openai', 'openai-compatible'])(
        'expands the %s reply’s in-window values into the proposed batch',
        async (dialect) => {
            runtimeMocks.dialect.value = dialect;
            const brief = await planRun();
            await confirm(brief);

            const card = requireOnlyProposedCard();
            expect(valueBodies).toHaveLength(1);
            expect(valueBodies.map(containsSampleData)).toEqual([false]);
            expect(parameterWrites(card)).toEqual(
                DRUMS_CHOICE.map((choice) => ({ paramId: choice.paramId, value: choice.value, trackId: DRUMS_ID }))
            );
            expect(card.approvalSnapshot.adoptedRecipes).toEqual([
                expect.objectContaining({ recipeId: 'drums-warm', targetId: DRUMS_ID, valueSource: 'measurements' }),
            ]);
            expect(cardContent(card)).toContain(
                'Recipe: Shell weight lifted, cymbal shelf eased on Drums — values chosen from measurements.'
            );
        }
    );

    // Red when the request stops carrying the target's baselines or the windows, or starts carrying audio.
    it('asks with the target’s baseline figures and every parameter window, and no audio', async () => {
        const brief = await planRun();
        await confirm(brief);

        const [body] = valueBodies;
        if (body === undefined) {
            throw new TypeError('Expected one value request');
        }
        const user = userMessageOf(body);
        expect(user).toMatchObject({
            pairs: [
                {
                    targetId: DRUMS_ID,
                    targetName: 'Drums',
                    recipeId: 'drums-warm',
                    parameters: [
                        { step: 0, paramId: 'eq-low-freq', minimum: 80, maximum: 120, catalogueDefault: 100 },
                        { step: 0, paramId: 'eq-low-gain', minimum: 2, maximum: 4, catalogueDefault: 3 },
                        { step: 0, paramId: 'eq-high-freq', minimum: 8000, maximum: 12000, catalogueDefault: 10000 },
                        { step: 0, paramId: 'eq-high-gain', minimum: -3, maximum: -1, catalogueDefault: -2 },
                    ],
                },
            ],
        });
        expect(user.ranges).toEqual([{ range: 'arrangement', startBeat: 0, endBeat: 4 }]);
        expect(readWirePairs(user)[0]?.baselines).toEqual([
            {
                metric: 'frequencyBandEnergy',
                band: 'bass',
                expected: 'increase',
                unit: expect.any(String),
                figures: { arrangement: expect.any(Number) },
            },
            {
                metric: 'spectralCentroid',
                band: null,
                expected: 'decrease',
                unit: expect.any(String),
                figures: { arrangement: expect.any(Number) },
            },
        ]);
        const text = JSON.stringify(body);
        expect(text).not.toMatch(/contentAddress|frameCount|sampleRate|"samples"/u);
        const longestArray = (value: unknown): number =>
            Array.isArray(value)
                ? Math.max(value.length, ...value.map(longestArray))
                : isRecord(value)
                  ? Math.max(0, ...Object.values(value).map(longestArray))
                  : 0;
        expect(longestArray(user)).toBeLessThan(16);
    });

    // Red when two tracks of one role get the same values whatever their measured baselines.
    it('chooses differing values for two tracks of one role whose baselines differ', async () => {
        const SECOND_ID = 'track-drums-room';
        landProjectEdit(() => {
            const state = trackStore.value;
            const drums = state?.tracks.find((track) => track.id === DRUMS_ID);
            if (state === null || drums === undefined) {
                throw new TypeError('Expected the fixture project');
            }
            const second = {
                ...createTrack({ id: SECOND_ID, name: 'Drums Room', kind: 'audio' }),
                clips: drums.clips.map((clip) => ({
                    ...clip,
                    id: `${SECOND_ID}-clip`,
                    trackId: SECOND_ID,
                    audioBufferId: `${SECOND_ID}-buffer`,
                })),
            };
            trackStore.set({ ...state, tracks: [...state.tracks, second] });
        });
        // The room track carries far less low end than the close drums, eq or not.
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) => {
            if (input.targetTrackId !== SECOND_ID) {
                return renderTrack(input);
            }
            const seconds = (input.endBeat - input.startBeat) / 2;
            return metricGoalAudioBuffer(
                (time) => 0.05 * Math.sin(2 * Math.PI * 100 * time) + 0.3 * Math.sin(2 * Math.PI * 3000 * time),
                seconds
            );
        });
        respond = ({ user }) => {
            const pairs = readWirePairs(user).map((pair) => {
                const bass = pair.baselines.find((baseline) => baseline.metric === 'frequencyBandEnergy')?.figures
                    .arrangement;
                if (typeof bass !== 'number') {
                    throw new TypeError('Expected a measured bass-band baseline');
                }
                // Less measured bass energy earns more low-shelf gain, inside the 2 to 4 dB window.
                const gain = Math.min(4, Math.max(2, 4 - 2 * bass));
                return {
                    targetId: pair.targetId,
                    recipeId: pair.recipeId,
                    values: [
                        { step: 0, paramId: 'eq-low-freq', value: 90 },
                        { step: 0, paramId: 'eq-low-gain', value: Number(gain.toFixed(3)) },
                        { step: 0, paramId: 'eq-high-freq', value: 9000 },
                        { step: 0, paramId: 'eq-high-gain', value: -1.5 },
                    ],
                };
            });
            return choose(pairs);
        };
        const brief = await planRun();
        await confirm(brief);

        const card = requireOnlyProposedCard();
        const gains = parameterWrites(card).filter((write) => write.paramId === 'eq-low-gain');
        expect(gains.map((write) => write.trackId).sort()).toEqual([DRUMS_ID, SECOND_ID].sort());
        const closeGain = gains.find((write) => write.trackId === DRUMS_ID)?.value;
        const roomGain = gains.find((write) => write.trackId === SECOND_ID)?.value;
        expect(typeof closeGain).toBe('number');
        expect(roomGain).toBeGreaterThan(closeGain ?? Number.POSITIVE_INFINITY);
    });
});

describe('falling back to catalogue defaults', () => {
    async function proposeDrumsWith(script: typeof respond): Promise<Confirmation> {
        respond = script;
        const brief = await planRun();
        await confirm(brief);
        return requireOnlyProposedCard();
    }

    // Red when a declined, failed or twice-refused reply changes any value or claims measured values.
    it.each<[string, typeof respond, string]>([
        [
            'declined',
            () => ({
                calls: [{ name: VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME, arguments: { reason: 'Already warm.' } }],
            }),
            'Recipe values are catalogue defaults: the hosted provider declined to choose values (Already warm).',
        ],
        ['failed', () => ({ status: 503 }), 'Recipe values are catalogue defaults: the hosted value request failed'],
        [
            'refused twice',
            () => drumsChoice([{ step: 0, paramId: 'eq-low-gain', value: 9 }]),
            'Recipe values are catalogue defaults: the hosted reply was refused, and so was its correction',
        ],
    ])('keeps the window middles when the provider %s', async (_case, script, reasonLine) => {
        const card = await proposeDrumsWith(script);

        expectMidpointWrites(card);
        expect(card.approvalSnapshot.adoptedRecipes).toEqual([
            expect.objectContaining({ recipeId: 'drums-warm', valueSource: 'catalogue-defaults' }),
        ]);
        expect(cardContent(card)).toContain('on Drums — catalogue defaults.');
        expect(cardContent(card)).toContain(reasonLine);
    });

    // Red when a refused reply is not corrected once, the correction does not carry its reason, or either
    // real request carries sample data.
    it('corrects a refused reply once, quoting the refusal, and applies the corrected values', async () => {
        const card = await proposeDrumsWith(({ index }) =>
            index === 0 ? drumsChoice([...DRUMS_CHOICE.slice(1)]) : drumsChoice()
        );

        expect(valueBodies).toHaveLength(2);
        expect(valueBodies.map(containsSampleData)).toEqual([false, false]);
        const correction = valueBodies[1] === undefined ? null : userMessageOf(valueBodies[1]);
        expect(correction).toMatchObject({
            rejection: 'choices[0].values is missing eq-low-freq of step 0',
            request: { pairs: [expect.objectContaining({ targetId: DRUMS_ID })] },
        });
        expect(String(correction?.refusedReply)).toContain('eq-low-gain');
        expect(parameterWrites(card).map((write) => write.value)).toEqual(DRUMS_CHOICE.map((choice) => choice.value));
    });

    // Red when a local chain asks the provider, or claims values chosen from measurements.
    it('asks nothing on a local chain and expands at the catalogue defaults', async () => {
        const brief = await planRun();
        runtimeMocks.backend.value = 'webllm';
        await confirm(brief);

        const card = requireOnlyProposedCard();
        expect(valueBodies).toEqual([]);
        expect(wire.requestAnthropic).not.toHaveBeenCalled();
        expect(wire.requestOpenAi).not.toHaveBeenCalled();
        expectMidpointWrites(card);
        expect(card.approvalSnapshot.adoptedRecipes?.[0]?.valueSource).toBe('catalogue-defaults');
        expect(cardContent(card)).toContain('the run is on a local backend');
    });
});

describe('when value requests are made', () => {
    // Red when a re-preview asks for values again, or the card loses its values or their source.
    it('re-previews a card with its own values and asks nothing more', async () => {
        const brief = await planRun();
        await confirm(brief);
        const card = requireOnlyProposedCard();
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

        await expect(reproposePendingChatActions({ confirmationId: card.id })).resolves.toMatchObject({
            status: 'reproposed',
        });

        const replacement = requireOnlyProposedCard();
        expect(valueBodies).toHaveLength(1);
        expect(parameterWrites(replacement).map((write) => write.value)).toEqual(
            DRUMS_CHOICE.map((choice) => choice.value)
        );
        expect(replacement.approvalSnapshot.adoptedRecipes?.[0]?.valueSource).toBe('measurements');
    });

    // Red when a blocked preview asks again or renders past the card it settled.
    it('asks once for a batch whose preview blocks, and nothing after its card settles', async () => {
        const brief = await planRun();
        // The batch's preview reads the drums as if no EQ were there, so its expected lift fails.
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: RenderInput) =>
            renderTrack({
                ...input,
                renderTracks: input.renderTracks.map((track) => ({ ...track, devices: [] })),
            })
        );
        await confirm(brief);

        const card = requireOnlyProposedCard();
        expect(getAgentApprovalView({ confirmationId: card.id })).toMatchObject({
            canConfirm: false,
            metricGoals: { status: 'blocked' },
        });
        expect(valueBodies).toHaveLength(1);
        expect(parameterWrites(card).map((write) => write.value)).toEqual(DRUMS_CHOICE.map((choice) => choice.value));

        await expect(reproposePendingChatActions({ confirmationId: card.id })).resolves.toMatchObject({
            status: 'reproposed',
        });

        expect(proposedCards()).toHaveLength(1);
        expect(valueBodies).toHaveLength(1);
    });

    // Red when a refused batch asks the provider before its guards refuse it.
    it('asks nothing for a batch whose target froze since planning', async () => {
        const brief = await planRun();
        // The plan names the Vocal; it freezes before the brief is confirmed, which asks for one re-approval.
        landProjectEdit(() => {
            const state = trackStore.value;
            if (state === null) {
                throw new TypeError('Expected the fixture project');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === VOCAL_ID ? { ...track, frozen: true } : track)),
            });
        });
        await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toMatchObject({
            status: 'reapproval_required',
        });
        await confirm(brief);
        await confirm(requireOnlyProposedCard());

        expect(messages()).toContain(
            'Batch 3 of 4 was not proposed: its target “Vocal” is frozen. Batches 1–2 remain applied.'
        );
        expect(valueBodies).toHaveLength(1);
        expect(messages().filter((content) => content.startsWith('Choosing values'))).toEqual([]);
    });

    // Red when a batch refused for brief drift asks the provider first.
    it('asks nothing for the next batch once the brief changed', async () => {
        const brief = await planRun();
        await confirm(brief);
        const drums = requireOnlyProposedCard();
        await editBrief();

        await skipPendingVibeBatch({ confirmationId: drums.id });

        expect(valueBodies).toHaveLength(1);
        expect(
            messages().some((content) => content.includes('production brief changed since this run was planned'))
        ).toBe(true);
    });

    // Red when a skip asks for the skipped batch's values again.
    it('asks once for each proposed batch and never again for a skipped one', async () => {
        respond = ({ user }) =>
            choose(
                readWirePairs(user).map((pair) => ({
                    targetId: pair.targetId,
                    recipeId: pair.recipeId,
                    values: pair.parameters.map((parameter) => ({
                        step: parameter.step,
                        paramId: parameter.paramId,
                        value: parameter.catalogueDefault,
                    })),
                }))
            );
        const brief = await planRun();
        await confirm(brief);
        const drums = requireOnlyProposedCard();

        await expect(skipPendingVibeBatch({ confirmationId: drums.id })).resolves.toEqual({ status: 'skipped' });

        const targets = valueBodies.map((body) => readWirePairs(userMessageOf(body)).map((pair) => pair.targetId));
        expect(targets).toEqual([[DRUMS_ID], [VOCAL_ID]]);
        expect(agentRunLifecycle.get(brief.runId)?.phase).toBe('waiting-for-approval');
    });
});

describe('readVibeBatchValueReply', () => {
    /** A window too narrow to hold any legal setting of a stepped parameter, beside an exact window. */
    const PAIRS: VibeBatchValuePair[] = [
        {
            targetId: 'track-a',
            recipeId: 'recipe-a',
            parameters: [
                {
                    step: 0,
                    deviceType: 'builtin-eq',
                    paramId: 'eq-low-gain',
                    minimum: 2,
                    maximum: 4,
                    catalogueDefault: 3,
                },
                {
                    step: 1,
                    deviceType: 'fermenter',
                    paramId: 'oscCoarse',
                    minimum: 2.2,
                    maximum: 2.4,
                    catalogueDefault: 2,
                },
                {
                    step: 1,
                    deviceType: 'fermenter',
                    paramId: 'oscLevel',
                    minimum: 0.5,
                    maximum: 0.5,
                    catalogueDefault: 0.5,
                },
            ],
        },
        {
            targetId: 'track-b',
            recipeId: 'recipe-b',
            parameters: [
                {
                    step: 0,
                    deviceType: 'builtin-eq',
                    paramId: 'eq-high-gain',
                    minimum: -3,
                    maximum: -1,
                    catalogueDefault: -2,
                },
            ],
        },
    ];

    type Value = { step: unknown; paramId: unknown; value: unknown };

    function valuesA(overrides: Partial<Record<string, unknown>> = {}): Value[] {
        return [
            { step: 0, paramId: 'eq-low-gain', value: overrides['eq-low-gain'] ?? 3.25 },
            { step: 1, paramId: 'oscCoarse', value: overrides.oscCoarse ?? 2 },
            { step: 1, paramId: 'oscLevel', value: overrides.oscLevel ?? 0.5 },
        ];
    }

    function reply(choices: unknown[]): ToolCallResult[] {
        return [{ name: VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME, arguments: { choices } }];
    }

    const pairB = {
        targetId: 'track-b',
        recipeId: 'recipe-b',
        values: [{ step: 0, paramId: 'eq-high-gain', value: -1.5 }],
    };

    // oscCoarse's window holds no legal setting, so a complete in-window reply uses a widened copy.
    const WIDE_PAIRS: VibeBatchValuePair[] = PAIRS.map((pair) => ({
        ...pair,
        parameters: pair.parameters.map((parameter) =>
            parameter.paramId === 'oscCoarse' ? { ...parameter, minimum: 1, maximum: 3 } : parameter
        ),
    }));

    // Red when a reply this table refuses has any part applied, or a valid one is refused.
    it.each<[string, readonly VibeBatchValuePair[], ToolCallResult[], string]>([
        [
            'a value below its minimum',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ 'eq-low-gain': 1.9 }) }, pairB]),
            'outside the window 2 to 4 of eq-low-gain',
        ],
        [
            'a value above its maximum',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ 'eq-low-gain': 4.1 }) }, pairB]),
            'outside the window 2 to 4 of eq-low-gain',
        ],
        [
            'a stepped value above its maximum whose legal setting falls back inside',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ oscCoarse: 3.4 }) }, pairB]),
            'value 3.4 is outside the window 1 to 3 of oscCoarse',
        ],
        [
            'NaN',
            WIDE_PAIRS,
            reply([
                { targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ 'eq-low-gain': Number.NaN }) },
                pairB,
            ]),
            'must be a finite number',
        ],
        [
            'Infinity',
            WIDE_PAIRS,
            reply([
                {
                    targetId: 'track-a',
                    recipeId: 'recipe-a',
                    values: valuesA({ 'eq-low-gain': Number.POSITIVE_INFINITY }),
                },
                pairB,
            ]),
            'must be a finite number',
        ],
        [
            'a string value',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ 'eq-low-gain': '3' }) }, pairB]),
            'must be a finite number',
        ],
        [
            'an in-window value whose legal setting leaves the window',
            PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ oscCoarse: 2.3 }) }, pairB]),
            'becomes the legal setting 2, outside the window 2.2 to 2.4 of oscCoarse',
        ],
        [
            'a paramId its step does not have',
            WIDE_PAIRS,
            reply([
                {
                    targetId: 'track-a',
                    recipeId: 'recipe-a',
                    values: [...valuesA(), { step: 0, paramId: 'eq-high-gain', value: -2 }],
                },
                pairB,
            ]),
            'paramId eq-high-gain is not a parameter of step 0',
        ],
        [
            'a step the recipe does not have',
            WIDE_PAIRS,
            reply([
                {
                    targetId: 'track-a',
                    recipeId: 'recipe-a',
                    values: [...valuesA(), { step: 4, paramId: 'eq-low-gain', value: 3 }],
                },
                pairB,
            ]),
            'step 4 is not a step of recipe recipe-a',
        ],
        [
            'a recipe assigned to another target of the batch',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-b', values: pairB.values }, pairB]),
            'recipeId recipe-b is not assigned to target track-a',
        ],
        [
            'a target not in the batch',
            WIDE_PAIRS,
            reply([{ targetId: 'track-z', recipeId: 'recipe-a', values: valuesA() }, pairB]),
            'targetId track-z is not a target of this batch',
        ],
        [
            'a pair given twice',
            WIDE_PAIRS,
            reply([
                { targetId: 'track-a', recipeId: 'recipe-a', values: valuesA() },
                { targetId: 'track-a', recipeId: 'recipe-a', values: valuesA() },
                pairB,
            ]),
            'gives recipe-a on track-a a second time',
        ],
        ['a missing pair', WIDE_PAIRS, reply([pairB]), 'choices is missing recipe-a on track-a'],
        [
            'a missing parameter',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA().slice(1) }, pairB]),
            'missing eq-low-gain of step 0',
        ],
        [
            'a parameter given twice',
            WIDE_PAIRS,
            reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: [...valuesA(), valuesA()[0]] }, pairB]),
            'gives eq-low-gain of step 0 a second value',
        ],
        [
            'one valid pair beside an invalid one',
            WIDE_PAIRS,
            reply([
                { targetId: 'track-a', recipeId: 'recipe-a', values: valuesA() },
                { ...pairB, values: [{ step: 0, paramId: 'eq-high-gain', value: 0 }] },
            ]),
            'outside the window -3 to -1 of eq-high-gain',
        ],
        [
            'both tools called',
            WIDE_PAIRS,
            [
                ...reply([{ targetId: 'track-a', recipeId: 'recipe-a', values: valuesA() }, pairB]),
                { name: VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME, arguments: { reason: 'no' } },
            ],
            'more than one call',
        ],
        ['no tool call', WIDE_PAIRS, [], 'called no tool'],
    ])('refuses the whole reply for %s', (_case, pairs, calls, reason) => {
        const read = readVibeBatchValueReply(pairs, calls);
        expect(read.status).toBe('rejected');
        expect(read).not.toHaveProperty('pairs');
        expect(read.status === 'rejected' ? read.reason : '').toContain(reason);
    });

    // Red when the keep-defaults tool reads as anything but a decline.
    it('reads the keep-defaults tool as a decline with its reason', () => {
        expect(
            readVibeBatchValueReply(PAIRS, [
                { name: VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME, arguments: { reason: '  Already balanced.  ' } },
            ])
        ).toEqual({ status: 'declined', reason: 'Already balanced.' });
    });

    // Red when a complete in-window reply, an exact window included, is refused or left unquantised.
    it('chooses every value of a complete in-window reply, quantised, with an exact window’s one value', () => {
        expect(
            readVibeBatchValueReply(
                WIDE_PAIRS,
                reply([pairB, { targetId: 'track-a', recipeId: 'recipe-a', values: valuesA({ oscCoarse: 2.4 }) }])
            )
        ).toEqual({
            status: 'chosen',
            pairs: [
                {
                    targetId: 'track-a',
                    recipeId: 'recipe-a',
                    values: [
                        { step: 0, paramId: 'eq-low-gain', value: 3.25 },
                        { step: 1, paramId: 'oscCoarse', value: 2 },
                        { step: 1, paramId: 'oscLevel', value: 0.5 },
                    ],
                },
                pairB,
            ],
        });
    });
});
