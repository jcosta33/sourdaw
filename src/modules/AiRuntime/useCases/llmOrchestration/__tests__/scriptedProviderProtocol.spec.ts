import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';

import { generateAnthropicToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateAnthropicToolCalls';
import { generateOpenAiCompatibleToolCalls } from '../../../repositories/cloudLlm/cloudInference/generateOpenAiCompatibleToolCalls';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { runApplicationOwnedToolLoop } from '../../applicationOwnedToolLoop';
import { getApplicationOwnedToolSchemas } from '../../getApplicationOwnedToolSchemas';
import {
    VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME,
    VIBE_BATCH_VALUE_TOOLS,
    type VibeBatchValueRequest,
} from '../../vibeRun/buildVibeBatchValueRequest';
import { chooseVibeBatchValues } from '../../vibeRun/chooseVibeBatchValues';

registerDeviceEnginePorts();

type MockTransportInput = {
    body: string;
    onBodyChunk: (chunk: Uint8Array) => void;
};

type MockOpenAiTransportInput = MockTransportInput & {
    runtime: unknown;
    signal: AbortSignal;
};

type ProviderCall = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
};

const transportMocks = vi.hoisted(() => ({
    anthropic: vi.fn(),
    openAiCompatible: vi.fn(),
}));
const valueChoiceRoute = vi.hoisted(() => ({ transport: { value: 'anthropic' as 'anthropic' | 'openai-compatible' } }));

vi.mock('../../../repositories/cloudLlm/cloudInference/requestAnthropicProvider', () => ({
    requestAnthropicProvider: transportMocks.anthropic,
}));

vi.mock('../../../repositories/cloudLlm/cloudInference/requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: transportMocks.openAiCompatible,
}));

vi.mock('../backendResolution/getBackendChain', () => ({ getBackendChain: () => ['cloud'] }));
vi.mock('../backendResolution/helpers', () => ({ resolveBackend: () => 'cloud' }));
vi.mock('../../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../../../repositories/cloudLlm/usesStrictCloudToolSchemas', () => ({
    usesStrictCloudToolSchemas: () => false,
}));
vi.mock('../../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () =>
        valueChoiceRoute.transport.value === 'anthropic'
            ? { provider: 'anthropic', model: 'claude-test', baseUrl: 'https://api.anthropic.com' }
            : { provider: 'openai-compatible', model: 'compatible-test', baseUrl: 'http://localhost:1234/v1' },
}));
vi.mock('../../../repositories/cloudLlm/getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: () =>
        valueChoiceRoute.transport.value === 'anthropic'
            ? {
                  provider: 'anthropic',
                  authentication: 'api-key',
                  model: 'claude-test',
                  session_id: `provider-session-${'0'.repeat(32)}`,
              }
            : {
                  provider: 'openai-compatible',
                  authentication: 'none',
                  session_id: null,
                  model: 'compatible-test',
                  base_url: 'http://localhost:1234/v1',
                  strict_tool_schemas: false,
              },
}));

const PROVIDER_CALLS: readonly ProviderCall[] = [
    {
        id: 'scripted-search',
        name: 'agent.command-index.search',
        arguments: { intent: 'mute track' },
    },
    {
        id: 'scripted-discovery',
        name: 'agent.catalog.discover',
        arguments: { category: 'command', names: ['muteTrack'] },
    },
    {
        id: 'scripted-proposal',
        name: 'command.batch.propose',
        arguments: { commands: [{ name: 'muteTrack', arguments: { trackId: 'track-1' } }] },
    },
];

const OMIT_DISCOVERY_CALLS = [
    PROVIDER_CALLS[0]!,
    {
        id: 'scripted-premature-proposal',
        name: 'command.batch.propose',
        arguments: { commands: [{ name: 'muteTrack', arguments: { trackId: 'track-1' } }] },
    },
] as const;

const ANTHROPIC_RUNTIME: Parameters<typeof generateAnthropicToolCalls>[0]['runtime'] = {
    provider: 'anthropic',
    authentication: 'api-key',
    session_id: 'scripted-session',
    model: 'scripted-model',
};

const OPENAI_COMPATIBLE_RUNTIME: Parameters<typeof generateOpenAiCompatibleToolCalls>[0]['runtime'] = {
    provider: 'openai-compatible',
    authentication: 'none',
    session_id: null,
    model: 'scripted-model',
    base_url: 'http://localhost:1234/v1',
    strict_tool_schemas: true,
};

function asAnthropicCall(call: ProviderCall): Record<string, unknown> {
    return {
        type: 'tool_use',
        id: call.id,
        name: call.name.replaceAll('.', '_'),
        input: call.arguments,
    };
}

function asOpenAiCall(call: ProviderCall): Record<string, unknown> {
    return {
        id: call.id,
        type: 'function',
        function: {
            name: call.name.replaceAll('.', '_'),
            arguments: JSON.stringify(call.arguments),
        },
    };
}

function anthropicResponse(call: ProviderCall, turn: number): Record<string, unknown> {
    return {
        id: `message-${String(turn)}`,
        type: 'message',
        role: 'assistant',
        content: [asAnthropicCall(call)],
        model: 'scripted-model',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
    };
}

function openAiResponse(call: ProviderCall, turn: number): Record<string, unknown> {
    return {
        id: `chatcmpl-${String(turn)}`,
        object: 'chat.completion',
        model: 'scripted-model',
        choices: [
            {
                index: 0,
                finish_reason: 'tool_calls',
                message: { role: 'assistant', content: null, tool_calls: [asOpenAiCall(call)] },
            },
        ],
    };
}

async function runScriptedLoop(input: { transport: 'anthropic' | 'openai-compatible' }) {
    const controller = new AbortController();
    return runApplicationOwnedToolLoop({
        loopId: `scripted-${input.transport}`,
        terminalToolNames: new Set(['command.batch.propose']),
        requestTurn: async ({ history, budgetNote, directive }) => {
            const common = {
                systemPrompt: 'Plan only through application-owned tools.',
                userMessage: 'Mute the named track.',
                toolSchemas: getApplicationOwnedToolSchemas(),
                maxOutputTokens: 128,
                directive,
                history,
                budgetNote,
                signal: controller.signal,
            };
            let plan;
            if (input.transport === 'anthropic') {
                plan = await generateAnthropicToolCalls({ ...common, runtime: ANTHROPIC_RUNTIME });
            } else {
                plan = await generateOpenAiCompatibleToolCalls({ ...common, runtime: OPENAI_COMPATIBLE_RUNTIME });
            }
            return {
                status: 'complete',
                toolCalls: plan.calls,
                providerTurn: {
                    provider: input.transport,
                    assistantItems: plan.assistantItems,
                },
            };
        },
    });
}

function expectAnthropicContinuation(request: Record<string, unknown>, expectedIds: readonly string[]): void {
    const messages = request.messages as { role: string; content: unknown }[];
    const toolUses = messages.flatMap((message) => {
        if (message.role !== 'assistant' || !Array.isArray(message.content)) {
            return [];
        }
        return (message.content as { type?: string; id?: string }[]).filter((item) => item.type === 'tool_use');
    });
    const toolResults = messages.flatMap((message) => {
        if (message.role !== 'user' || !Array.isArray(message.content)) {
            return [];
        }
        return (message.content as { type?: string; tool_use_id?: string }[]).filter(
            (item) => item.type === 'tool_result'
        );
    });
    expect(toolUses.map(({ id }) => id)).toEqual(expectedIds);
    expect(toolResults.map(({ tool_use_id }) => tool_use_id)).toEqual(expectedIds);
}

function expectOpenAiContinuation(request: Record<string, unknown>, expectedIds: readonly string[]): void {
    const messages = request.messages as {
        role: string;
        tool_calls?: { id: string }[];
        tool_call_id?: string;
    }[];
    const toolCalls = messages.flatMap((message) => (message.role === 'assistant' ? (message.tool_calls ?? []) : []));
    const toolResults = messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id);
    expect(toolCalls.map(({ id }) => id)).toEqual(expectedIds);
    expect(toolResults).toEqual(expectedIds);
}

beforeEach(() => {
    transportMocks.anthropic.mockReset();
    transportMocks.openAiCompatible.mockReset();
});

describe('scripted provider protocol through the application-owned planning loop', () => {
    // This exercises command-index discovery. Request-dependent measurement and recipe obligations
    // are intentionally outside this protocol fixture.
    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s replays native call and receipt IDs before a normal proposal',
        async (transport) => {
            const { requests, refusals } = installStrictResponses(
                transport,
                PROVIDER_CALLS.map((call, index) =>
                    transport === 'anthropic' ? anthropicResponse(call, index + 1) : openAiResponse(call, index + 1)
                )
            );

            const result = await runScriptedLoop({ transport });

            expect(result).toMatchObject({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'scripted-proposal',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'muteTrack', arguments: { trackId: 'track-1' } }] },
                    },
                ],
                receipts: [
                    { callId: 'scripted-search', toolName: 'agent.command-index.search', status: 'success' },
                    { callId: 'scripted-discovery', toolName: 'agent.catalog.discover', status: 'success' },
                ],
            });
            expect(requests).toHaveLength(3);
            if (transport === 'anthropic') {
                expectAnthropicContinuation(requests[1]!, ['scripted-search']);
                expectAnthropicContinuation(requests[2]!, ['scripted-search', 'scripted-discovery']);
            } else {
                expectOpenAiContinuation(requests[1]!, ['scripted-search']);
                expectOpenAiContinuation(requests[2]!, ['scripted-search', 'scripted-discovery']);
            }
            expect(refusals).toEqual([]);
        }
    );

    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s refuses a proposal when command discovery is skipped after a real search',
        async (transport) => {
            const { requests, refusals } = installStrictResponses(
                transport,
                OMIT_DISCOVERY_CALLS.map((call, index) =>
                    transport === 'anthropic' ? anthropicResponse(call, index + 1) : openAiResponse(call, index + 1)
                )
            );

            const result = await runScriptedLoop({ transport });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Provider command proposal referenced an undiscovered catalog command.',
                receipts: [{ callId: 'scripted-search', toolName: 'agent.command-index.search', status: 'success' }],
                turns: 2,
            });
            expect(requests).toHaveLength(2);
            if (transport === 'anthropic') {
                expectAnthropicContinuation(requests[1]!, ['scripted-search']);
            } else {
                expectOpenAiContinuation(requests[1]!, ['scripted-search']);
            }
            expect(refusals).toEqual([]);
        }
    );
});

type Transport = 'anthropic' | 'openai-compatible';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMessages(request: Record<string, unknown>): Record<string, unknown>[] {
    if (!Array.isArray(request.messages)) {
        throw new TypeError('Expected the request to carry a messages array.');
    }
    return request.messages.filter(isRecord);
}

function readBlocks(message: Record<string, unknown> | undefined, type: string): Record<string, unknown>[] {
    if (message === undefined || !Array.isArray(message.content)) {
        return [];
    }
    return message.content.filter(isRecord).filter((block) => block.type === type);
}

function readIds(items: readonly Record<string, unknown>[], key: string): string[] {
    return items.flatMap((item) => (typeof item[key] === 'string' ? [item[key]] : []));
}

function sameIdsExactlyOnce(callIds: readonly string[], resultIds: readonly string[]): boolean {
    return (
        callIds.length === resultIds.length &&
        new Set(callIds).size === callIds.length &&
        new Set(resultIds).size === resultIds.length &&
        callIds.every((id) => resultIds.includes(id))
    );
}

function findAnthropicToolResultIdProblem(messages: readonly Record<string, unknown>[]): string | null {
    for (const [index, message] of messages.entries()) {
        const callIds = readIds(message.role === 'assistant' ? readBlocks(message, 'tool_use') : [], 'id');
        const resultIds = readIds(message.role === 'user' ? readBlocks(message, 'tool_result') : [], 'tool_use_id');
        if (callIds.length > 0) {
            const answers = readIds(readBlocks(messages[index + 1], 'tool_result'), 'tool_use_id');
            if (!sameIdsExactlyOnce(callIds, answers)) {
                return `tool_use ids ${callIds.join(',')} are answered by tool_result ids ${answers.join(',')}, not exactly once each`;
            }
        }
        if (resultIds.length > 0) {
            const previous = messages[index - 1];
            const precedingIds = readIds(previous?.role === 'assistant' ? readBlocks(previous, 'tool_use') : [], 'id');
            if (!sameIdsExactlyOnce(precedingIds, resultIds)) {
                return `tool_result ids ${resultIds.join(',')} do not match the preceding tool_use ids ${precedingIds.join(',')}`;
            }
        }
    }
    return null;
}

function findOpenAiToolResultIdProblem(messages: readonly Record<string, unknown>[]): string | null {
    for (const [index, message] of messages.entries()) {
        if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
            const callIds = readIds(message.tool_calls.filter(isRecord), 'id');
            const resultIds: string[] = [];
            for (const following of messages.slice(index + 1)) {
                if (following.role !== 'tool') {
                    break;
                }
                resultIds.push(typeof following.tool_call_id === 'string' ? following.tool_call_id : '');
            }
            if (!sameIdsExactlyOnce(callIds, resultIds)) {
                return `tool_calls ids ${callIds.join(',')} are not answered by tool messages ${resultIds.join(',')}`;
            }
        }
        if (message.role === 'tool') {
            const owner = messages
                .slice(0, index)
                .reverse()
                .find((candidate) => candidate.role !== 'tool');
            const ownerIds = Array.isArray(owner?.tool_calls) ? readIds(owner.tool_calls.filter(isRecord), 'id') : [];
            if (typeof message.tool_call_id !== 'string' || !ownerIds.includes(message.tool_call_id)) {
                return `tool message ${String(message.tool_call_id)} answers no tool call of the preceding assistant turn`;
            }
        }
    }
    return null;
}

/**
 * The rule both real APIs enforce: a request that continues a conversation answers every tool call of
 * the assistant turn right before it, each exactly once, and answers nothing else.
 */
function findToolResultIdProblem(transport: Transport, request: Record<string, unknown>): string | null {
    const messages = readMessages(request);
    return transport === 'anthropic'
        ? findAnthropicToolResultIdProblem(messages)
        : findOpenAiToolResultIdProblem(messages);
}

/** What a request-side adapter defect looks like: every tool result names an id its turn never issued. */
function withMismatchedToolResultIds(transport: Transport, request: Record<string, unknown>): Record<string, unknown> {
    const messages = readMessages(request).map((message) => {
        if (transport === 'anthropic' && message.role === 'user' && Array.isArray(message.content)) {
            return {
                ...message,
                content: message.content
                    .filter(isRecord)
                    .map((block) =>
                        block.type === 'tool_result'
                            ? { ...block, tool_use_id: `${String(block.tool_use_id)}-mismatch` }
                            : block
                    ),
            };
        }
        if (transport === 'openai-compatible' && message.role === 'tool') {
            return { ...message, tool_call_id: `${String(message.tool_call_id)}-mismatch` };
        }
        return message;
    });
    return { ...request, messages };
}

type StrictDoubleOptions = { mismatchToolResultIds?: boolean };

/**
 * A scripted provider double that is strict like the real APIs: a request whose tool results do not answer the
 * preceding assistant turn's tool calls is refused with a 400, and it is recorded either way.
 */
function installStrictResponses(
    transport: Transport,
    responses: readonly Record<string, unknown>[],
    options: StrictDoubleOptions = {}
): { requests: Record<string, unknown>[]; refusals: string[] } {
    const requests: Record<string, unknown>[] = [];
    const refusals: string[] = [];
    const transportMock = transport === 'anthropic' ? transportMocks.anthropic : transportMocks.openAiCompatible;
    let responseIndex = 0;
    transportMock.mockImplementation(async (input: MockTransportInput | MockOpenAiTransportInput) => {
        const parsed = JSON.parse(input.body) as Record<string, unknown>;
        const request =
            options.mismatchToolResultIds === true ? withMismatchedToolResultIds(transport, parsed) : parsed;
        requests.push(request);
        const problem = findToolResultIdProblem(transport, request);
        if (problem !== null) {
            refusals.push(problem);
            input.onBodyChunk(new TextEncoder().encode(JSON.stringify({ error: { message: problem } })));
            return { status: 400, contentType: 'application/json' };
        }
        const response = responses[responseIndex];
        responseIndex += 1;
        if (response === undefined) {
            throw new Error('Scripted provider response fixture was exhausted.');
        }
        input.onBodyChunk(new TextEncoder().encode(JSON.stringify(response)));
        return { status: 200, contentType: 'application/json' };
    });
    return { requests, refusals };
}

function scriptedReply(transport: Transport, call: ProviderCall, turn: number): Record<string, unknown> {
    return transport === 'anthropic' ? anthropicResponse(call, turn) : openAiResponse(call, turn);
}

type ValueRequestPair = {
    targetId: string;
    recipeId: string;
    paramId: string;
    minimum: number;
    maximum: number;
    catalogueDefault: number;
    baseline: number;
};

const VALUE_PAIRS: readonly ValueRequestPair[] = [
    {
        targetId: 'drums',
        recipeId: 'drums-warm',
        paramId: 'eq-low-gain',
        minimum: 2,
        maximum: 4,
        catalogueDefault: 3,
        baseline: 0.4217,
    },
    {
        targetId: 'bass',
        recipeId: 'bass-warm',
        paramId: 'eq-low-gain',
        minimum: 1,
        maximum: 3,
        catalogueDefault: 2,
        baseline: 0.6359,
    },
];

/** A two-pair value request in the shape buildVibeBatchValueRequest gives: baseline figures and windows. */
function valueRequest(): VibeBatchValueRequest {
    const windowOf = (pair: ValueRequestPair) => ({
        step: 0,
        paramId: pair.paramId,
        minimum: pair.minimum,
        maximum: pair.maximum,
        catalogueDefault: pair.catalogueDefault,
    });
    return {
        pairs: VALUE_PAIRS.map((pair) => ({
            targetId: pair.targetId,
            recipeId: pair.recipeId,
            parameters: [{ ...windowOf(pair), deviceType: 'builtin-eq' }],
        })),
        systemPrompt: 'Choose recipe parameter values inside their windows.',
        userMessage: JSON.stringify({
            batch: { id: 'batch-1', descriptors: ['warm'], role: 'drums' },
            ranges: [{ range: 'arrangement', startBeat: 0, endBeat: 8 }],
            pairs: VALUE_PAIRS.map((pair) => ({
                targetId: pair.targetId,
                targetName: pair.targetId,
                recipeId: pair.recipeId,
                baselines: [
                    {
                        metric: 'frequencyBandEnergy',
                        band: 'bass',
                        expected: 'increase',
                        unit: 'ratio',
                        figures: { arrangement: pair.baseline },
                    },
                ],
                parameters: [windowOf(pair)],
            })),
        }),
        tools: VIBE_BATCH_VALUE_TOOLS,
        maxOutputTokens: 1_200,
    };
}

function chooseCall(
    id: string,
    pairs: readonly ValueRequestPair[],
    gainOf: (pair: ValueRequestPair) => number
): ProviderCall {
    return {
        id,
        name: VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME,
        arguments: {
            choices: pairs.map((pair) => ({
                targetId: pair.targetId,
                recipeId: pair.recipeId,
                values: [{ step: 0, paramId: pair.paramId, value: gainOf(pair) }],
            })),
        },
    };
}

/** An in-window value no catalogue default equals, per pair. */
function inWindowGain(pair: ValueRequestPair): number {
    return pair.minimum + 0.5;
}

const VALUE_RUN_ID = 'run-value-choice-protocol';

function chooseValues() {
    return chooseVibeBatchValues({ runId: VALUE_RUN_ID, request: valueRequest() });
}

function userContentOf(request: Record<string, unknown>): string {
    const [first] = readMessages(request).filter((message) => message.role === 'user');
    return JSON.stringify(first?.content ?? null);
}

function expectFreshMessage(transport: Transport, request: Record<string, unknown>): void {
    const messages = readMessages(request);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    if (transport === 'anthropic') {
        expect(messages.flatMap((message) => readBlocks(message, 'tool_result'))).toEqual([]);
        expect(messages.flatMap((message) => readBlocks(message, 'tool_use'))).toEqual([]);
    } else {
        expect(messages.filter((message) => message.role === 'tool')).toEqual([]);
        expect(messages.filter((message) => 'tool_calls' in message)).toEqual([]);
    }
}

function transportMockOf(transport: Transport) {
    return transport === 'anthropic' ? transportMocks.anthropic : transportMocks.openAiCompatible;
}

function otherTransportMockOf(transport: Transport) {
    return transport === 'anthropic' ? transportMocks.openAiCompatible : transportMocks.anthropic;
}

describe('scripted value choice follows the provider protocols', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: VALUE_RUN_ID,
            request: 'make the mix warmer',
            mode: 'plan',
            createdRevision: null,
        });
    });

    afterEach(() => {
        agentRunLifecycle.clear();
    });

    // Red when the value request stops reaching its transport or stops carrying the baseline figures.
    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s receives the value request with its baselines and yields the chosen in-window values',
        async (transport) => {
            valueChoiceRoute.transport.value = transport;
            const { requests } = installStrictResponses(transport, [
                scriptedReply(transport, chooseCall('scripted-values', VALUE_PAIRS, inWindowGain), 1),
            ]);

            const outcome = await chooseValues();

            expect(outcome).toEqual({
                source: 'measurements',
                pairs: VALUE_PAIRS.map((pair) => ({
                    targetId: pair.targetId,
                    recipeId: pair.recipeId,
                    values: [{ step: 0, paramId: pair.paramId, value: inWindowGain(pair) }],
                })),
            });
            expect(requests).toHaveLength(1);
            const request = requests[0] ?? {};
            expect(Array.isArray(request.messages)).toBe(true);
            const sent = userContentOf(request);
            expect(sent).toContain('frequencyBandEnergy');
            for (const pair of VALUE_PAIRS) {
                expect(sent).toContain(String(pair.baseline));
            }
            expectFreshMessage(transport, request);
            expect(otherTransportMockOf(transport)).not.toHaveBeenCalled();
        }
    );

    // Red when a reply that skips a measured pair is accepted, applied, or corrected more than once.
    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s refuses a reply that skips a measured pair, corrects once on a fresh message, then falls back to defaults',
        async (transport) => {
            valueChoiceRoute.transport.value = transport;
            const answeredPairs = VALUE_PAIRS.slice(0, 1);
            const { requests } = installStrictResponses(transport, [
                scriptedReply(transport, chooseCall('scripted-skip-1', answeredPairs, inWindowGain), 1),
                scriptedReply(transport, chooseCall('scripted-skip-2', answeredPairs, inWindowGain), 2),
            ]);

            const outcome = await chooseValues();

            expect(outcome).toEqual({
                source: 'catalogue-defaults',
                reason: 'correction-exhausted',
                detail: 'choices is missing bass-warm on bass',
            });
            expect(outcome).not.toHaveProperty('pairs');
            expect(requests).toHaveLength(2);
            const correction = userContentOf(requests[1] ?? {});
            expect(correction).toContain('choices is missing bass-warm on bass');
            expect(correction).toContain('refusedReply');
            expectFreshMessage(transport, requests[1] ?? {});
            expect(transportMockOf(transport)).toHaveBeenCalledTimes(2);
            expect(otherTransportMockOf(transport)).not.toHaveBeenCalled();
        }
    );

    // Red when the strict double stops refusing a tool result whose id its assistant turn never issued.
    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s ends the planning loop non-complete when a tool result carries a mismatched id',
        async (transport) => {
            const { requests, refusals } = installStrictResponses(
                transport,
                PROVIDER_CALLS.map((call, index) => scriptedReply(transport, call, index + 1)),
                { mismatchToolResultIds: true }
            );

            const outcome = await runScriptedLoop({ transport }).then(
                (result) => result.status,
                () => 'threw'
            );

            expect(outcome).not.toBe('complete');
            expect(requests).toHaveLength(2);
            expect(findToolResultIdProblem(transport, requests[0] ?? {})).toBeNull();
            // The refusal is the injected id's, not a dropped or reordered tool result.
            expect(refusals).toHaveLength(1);
            expect(refusals[0]).toContain('scripted-search-mismatch');
        }
    );

    // Red when the continuation assertions stop comparing ids, so a mismatched id would pass them.
    it.each(['anthropic', 'openai-compatible'] as const)(
        '%s continuation assertions fail on a mismatched tool-result id',
        async (transport) => {
            const { requests } = installStrictResponses(
                transport,
                PROVIDER_CALLS.map((call, index) => scriptedReply(transport, call, index + 1))
            );
            await runScriptedLoop({ transport });
            const continuation = requests[1];
            if (continuation === undefined) {
                throw new Error('Expected the loop to continue the conversation.');
            }
            const expectContinuation =
                transport === 'anthropic' ? expectAnthropicContinuation : expectOpenAiContinuation;

            expect(findToolResultIdProblem(transport, continuation)).toBeNull();
            expect(() => {
                expectContinuation(continuation, ['scripted-search']);
            }).not.toThrow();
            expect(() => {
                expectContinuation(withMismatchedToolResultIds(transport, continuation), ['scripted-search']);
            }).toThrow();
        }
    );
});
