import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApplicationToolReceipt } from '../../../models/ApplicationOwnedTool';
import { type HostedTurnCall, type HostedTurnHistory } from '../../../models/HostedTurnHistory';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { compileProviderAdapterInstallation, OPENAI_RESPONSES_ADAPTER_ID } from '../../providerAdapterRegistry';
import { generateOpenAiResponsesToolCalls } from '../cloudInference/generateOpenAiResponsesToolCalls';
import { AUTO_TOOL_CHOICE } from '../cloudInference/hostedToolPlan';
import { type OpenAiCloudRuntime } from '../cloudSession';

const mocks = vi.hoisted(() => ({ runProviderGatewayRequest: vi.fn() }));

vi.mock('../../providerGateway', () => ({
    runProviderGatewayRequest: mocks.runProviderGatewayRequest,
}));

vi.mock('../../ensureAdapterCapabilities', () => ({
    ensureAdapterCapabilities: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const runtime: OpenAiCloudRuntime = {
    provider: 'openai',
    model: 'reasoning-model-v1',
    base_url: 'https://api.openai.com/v1',
    authentication: 'api-key',
    adapter: compileProviderAdapterInstallation({
        adapterId: OPENAI_RESPONSES_ADAPTER_ID,
        providerId: 'openai',
        modelId: 'reasoning-model-v1',
        protocolFamily: 'openai-responses',
        origin: 'https://api.openai.com',
    }),
    session_id: `provider-session-${'0'.repeat(32)}`,
};

const toolSchemas: ToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'project.query',
            description: 'Read the current project',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'setTempo',
            description: 'Set tempo',
            parameters: {
                type: 'object',
                properties: { bpm: { type: 'number' } },
                required: ['bpm'],
                additionalProperties: false,
            },
        },
    },
];

const FIRST_USER_MESSAGE = 'inspect the project, then set the tempo';
const BUDGET_NOTE = 'Remaining budget: 2 turn(s), 6 tool call(s), 40000 receipt byte(s).';

/** The item the Responses API carries its own thinking in; it is meaningless to any other model. */
const REASONING_ITEM = {
    type: 'reasoning',
    id: 'rs_carried_item',
    summary: [{ type: 'summary_text', text: 'Check the project before editing.' }],
    encrypted_content: 'opaque-reasoning-state',
};

const FIRST_TURN_FUNCTION_CALL = {
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_query_1',
    name: 'project_query',
    arguments: '{}',
};

const FIRST_TURN_RESPONSE = {
    id: 'resp_1',
    status: 'completed',
    output: [REASONING_ITEM, FIRST_TURN_FUNCTION_CALL],
};

const SECOND_TURN_RESPONSE = {
    id: 'resp_2',
    status: 'completed',
    output: [
        { type: 'function_call', id: 'fc_2', call_id: 'call_tempo_1', name: 'setTempo', arguments: '{"bpm":128}' },
    ],
};

const RECEIPT: ApplicationToolReceipt = {
    schema: 'sourdaw.application-tool-receipt',
    schemaVersion: 1,
    callId: 'call_query_1',
    toolName: 'project.query',
    turn: 1,
    status: 'success',
    revision: 'revision-2',
    data: { items: [] },
    summary: 'Queried the project.',
    warnings: [],
    error: null,
};

let sentRequestBodies: string[] = [];

function respondWith(payload: Record<string, unknown>): void {
    mocks.runProviderGatewayRequest.mockImplementationOnce(
        async (request: {
            body: string | null;
            onResponseStart: (value: { status: number; contentType: string | null }) => void;
            onBodyChunk: (chunk: Uint8Array) => void;
        }) => {
            sentRequestBodies.push(request.body ?? '');
            request.onResponseStart({ status: 200, contentType: 'application/json' });
            request.onBodyChunk(new TextEncoder().encode(JSON.stringify(payload)));
        }
    );
}

function readBody(index: number): Record<string, unknown> {
    const sent = sentRequestBodies[index];
    if (sent === undefined || sent.length === 0) {
        throw new Error('Expected the adapter to send a JSON request body');
    }
    return JSON.parse(sent) as Record<string, unknown>;
}

/** The record form of a planned turn's calls, each under the identifier its receipt carries. */
function recordedCalls(
    calls: readonly { id?: string; name: string; arguments: Record<string, unknown> }[]
): HostedTurnCall[] {
    return calls.map((call) => ({ id: call.id ?? RECEIPT.callId, name: call.name, arguments: call.arguments }));
}

function planTurn(history: HostedTurnHistory): ReturnType<typeof generateOpenAiResponsesToolCalls> {
    return generateOpenAiResponsesToolCalls({
        runtime,
        systemPrompt: 'system',
        userMessage: FIRST_USER_MESSAGE,
        toolSchemas,
        maxOutputTokens: 8_192,
        directive: AUTO_TOOL_CHOICE,
        history,
        budgetNote: BUDGET_NOTE,
    });
}

beforeEach(() => {
    sentRequestBodies = [];
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() => Promise.reject(new Error('The privileged adapter must not use renderer networking')))
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

/**
 * A reasoning model loses the thinking behind its own tool call unless the items it produced are
 * handed back on the next turn. These run the two turns the application-owned loop runs, taking
 * the second turn's history from what the first turn actually reported.
 */
describe('OpenAI responses reasoning carry-over', () => {
    it('sends the first turn as one user message with no replayed items', async () => {
        respondWith(FIRST_TURN_RESPONSE);

        await planTurn([]);

        expect(readBody(0).input).toEqual([{ role: 'user', content: FIRST_USER_MESSAGE }]);
    });

    it('replays the first turn output verbatim, reasoning item included, before the receipts and the note', async () => {
        respondWith(FIRST_TURN_RESPONSE);
        respondWith(SECOND_TURN_RESPONSE);

        const firstTurn = await planTurn([]);
        const secondTurn = await planTurn([
            {
                turn: 1,
                provider: 'openai',
                assistantItems: firstTurn.assistantItems,
                calls: recordedCalls(firstTurn.calls),
                receipts: [RECEIPT],
            },
        ]);

        const replayed = readBody(1).input as unknown[];
        expect(replayed).toEqual([
            { role: 'user', content: FIRST_USER_MESSAGE },
            REASONING_ITEM,
            FIRST_TURN_FUNCTION_CALL,
            { type: 'function_call_output', call_id: RECEIPT.callId, output: JSON.stringify(RECEIPT) },
            { role: 'user', content: BUDGET_NOTE },
        ]);
        // The reasoning item precedes the call it produced, exactly where the response carried it.
        expect(replayed[1]).toEqual(REASONING_ITEM);
        expect(replayed[2]).toEqual(FIRST_TURN_FUNCTION_CALL);
        expect(secondTurn.calls).toEqual([{ id: 'call_tempo_1', name: 'setTempo', arguments: { bpm: 128 } }]);
    });

    it('keeps the replayed turn request-scoped and asks for no extra response parts', async () => {
        respondWith(FIRST_TURN_RESPONSE);
        respondWith(SECOND_TURN_RESPONSE);

        const firstTurn = await planTurn([]);
        await planTurn([
            {
                turn: 1,
                provider: 'openai',
                assistantItems: firstTurn.assistantItems,
                calls: recordedCalls(firstTurn.calls),
                receipts: [RECEIPT],
            },
        ]);

        const body = readBody(1);
        expect(body.store).toBe(false);
        expect('include' in body).toBe(false);
    });
});
