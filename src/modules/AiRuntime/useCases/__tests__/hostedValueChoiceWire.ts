import { vi, type Mock } from 'vitest';

import { BRIEF_ROUTE, DRUMS_ID, type Confirmation } from '../../__tests__/vibeRunWorkflowFixture';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { encodeWireToolName } from '../../repositories/cloudLlm/cloudInference/encodeWireToolName';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME } from '../vibeRun/buildVibeBatchValueRequest';

/** The drums-warm window the batch's one recipe authors, and values inside it that no EQ starts at. */
export const DRUMS_CHOICE = [
    { step: 0, paramId: 'eq-low-freq', value: 90 },
    { step: 0, paramId: 'eq-low-gain', value: 3.5 },
    { step: 0, paramId: 'eq-high-freq', value: 9000 },
    { step: 0, paramId: 'eq-high-gain', value: -1.5 },
];

export type Reply = { calls: ToolCallResult[] } | { text: string } | { status: number };

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value request's own JSON user message, wherever the dialect put it. */
export function readUserJson(value: unknown): Record<string, unknown> | null {
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

type AnsweredReply = Exclude<Reply, { status: number }>;

/** The Anthropic Messages content blocks for a reply: one text block, or one `tool_use` block per call. */
function anthropicContent(reply: AnsweredReply): unknown[] {
    if ('text' in reply) {
        return [{ type: 'text', text: reply.text }];
    }
    return reply.calls.map((call, index) => ({
        type: 'tool_use',
        id: `toolu_${String(index)}`,
        name: encodeWireToolName(call.name),
        input: call.arguments,
    }));
}

/** The OpenAI Responses output items for a reply: one message item, or one `function_call` item per call. */
function openAiResponsesOutput(reply: AnsweredReply): unknown[] {
    if ('text' in reply) {
        return [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply.text }] }];
    }
    return reply.calls.map((call, index) => ({
        type: 'function_call',
        id: `fc_${String(index)}`,
        call_id: `call_${String(index)}`,
        name: encodeWireToolName(call.name),
        arguments: JSON.stringify(call.arguments),
    }));
}

/** The Chat Completions assistant message for a reply: text content, or `tool_calls` with null content. */
function chatCompletionsMessage(reply: AnsweredReply): unknown {
    if ('text' in reply) {
        return { role: 'assistant', content: reply.text };
    }
    return {
        role: 'assistant',
        content: null,
        tool_calls: reply.calls.map((call, index) => ({
            id: `call_${String(index)}`,
            type: 'function',
            function: { name: encodeWireToolName(call.name), arguments: JSON.stringify(call.arguments) },
        })),
    };
}

function encodeReply(dialect: string, reply: Reply): { status: number; body: string } {
    if ('status' in reply) {
        return { status: reply.status, body: '{"error":{"message":"overloaded"}}' };
    }
    const usage = { input: 900, output: 120 };
    if (dialect === 'anthropic') {
        return {
            status: 200,
            body: JSON.stringify({
                id: 'msg_values',
                type: 'message',
                role: 'assistant',
                content: anthropicContent(reply),
                stop_reason: 'text' in reply ? 'end_turn' : 'tool_use',
                usage: { input_tokens: usage.input, output_tokens: usage.output },
            }),
        };
    }
    if (dialect === 'openai') {
        return {
            status: 200,
            body: JSON.stringify({
                id: 'resp_values',
                status: 'completed',
                output: openAiResponsesOutput(reply),
                usage: { input_tokens: usage.input, output_tokens: usage.output },
            }),
        };
    }
    const message = chatCompletionsMessage(reply);
    return {
        status: 200,
        body: JSON.stringify({
            id: 'chatcmpl-values',
            choices: [{ index: 0, finish_reason: 'text' in reply ? 'stop' : 'tool_calls', message }],
            usage: { prompt_tokens: usage.input, completion_tokens: usage.output },
        }),
    };
}

type WireRequest = { body: string; onBodyChunk: (chunk: Uint8Array) => void };
export type WireAnswer = (request: WireRequest) => Promise<{ status: number; contentType: string }>;
type ValueWire = { requestAnthropic: Mock<WireAnswer>; requestOpenAi: Mock<WireAnswer> };

/** Answers each hosted value request the spec's scripted wire reads, in the dialect the spec runs. */
export function armValueWire(
    wire: ValueWire,
    readDialect: () => string,
    answerValueRequest: (body: Record<string, unknown>, user: Record<string, unknown>) => Reply
): void {
    const answer: WireAnswer = async (request) => {
        const body: unknown = JSON.parse(request.body);
        if (!isRecord(body)) {
            throw new TypeError('Expected a JSON body');
        }
        const user = readUserJson(body);
        if (user === null) {
            throw new Error('A provider request that is not a value request reached the wire.');
        }
        const reply = encodeReply(readDialect(), answerValueRequest(body, user));
        request.onBodyChunk(new TextEncoder().encode(reply.body));
        return { status: reply.status, contentType: 'application/json' };
    };
    wire.requestAnthropic.mockReset().mockImplementation(answer);
    wire.requestOpenAi.mockReset().mockImplementation(answer);
}

/** The brief route is scripted; a value request goes through the real hosted route to the wire. */
export function scriptBriefRoute(original: typeof generateToolPlanningOutcome | null): void {
    let briefTurn = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (...args) => {
        const [, userMessage, schemas] = args;
        if (schemas.some((schema: ToolSchema) => schema.function.name === VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME)) {
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
        return { status: 'complete', toolCalls: turn({ userMessage, schemas }), proposal: null };
    });
}

export function choose(pairs: { targetId: string; recipeId: string; values: unknown[] }[]): Reply {
    return { calls: [{ name: VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME, arguments: { choices: pairs } }] };
}

export function drumsChoice(values: unknown[] = DRUMS_CHOICE): Reply {
    return choose([{ targetId: DRUMS_ID, recipeId: 'drums-warm', values }]);
}

/** Each parameter write of the card, on the track whose added device it writes. */
export function parameterWrites(card: Confirmation) {
    const trackOfDevice = new Map(
        card.actions.flatMap((action) => {
            if (action.type !== 'addDevice' || action.payload.deviceId === undefined) {
                return [];
            }
            return [[action.payload.deviceId, action.payload.trackId] as const];
        })
    );
    return card.actions.flatMap((action) => {
        if (action.type !== 'setDeviceParameter') {
            return [];
        }
        return [
            {
                paramId: action.payload.paramId,
                value: action.payload.value,
                trackId: trackOfDevice.get(action.payload.deviceId) ?? null,
            },
        ];
    });
}
