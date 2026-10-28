import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * A real OpenAI-compatible endpoint on loopback, for E2E runs that need an
 * admitted AI backend without hardware or network.
 *
 * `configureCloudProvider` admits an unauthenticated `http://127.0.0.1` base URL
 * on every platform (see `docs/architecture/09-ai-stack.md`), so a runner with
 * no WebGPU adapter still reaches a genuinely admitted backend: the app resolves
 * `cloud`, and every request it makes is served here rather than stubbed inside
 * the page. Nothing leaves the machine.
 */

const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const MODEL_ID = 'sourdaw-e2e-loopback';
const MAX_REQUEST_BYTES = 1_024 * 1_024;

export type LoopbackToolCall = { id: string; name: string; arguments: Record<string, unknown> };
type LoopbackOpenAiProviderOptions = {
    /** Assistant text the endpoint streams back for ordinary chat completions. */
    reply?: string;
    /** Explicit tool calls served in order to non-streaming completion requests. */
    toolCalls?: readonly (LoopbackToolCall | ((request: unknown) => LoopbackToolCall))[];
};

export const LOOPBACK_STRUCTURAL_ANSWER_PREFIX = 'The project has';

export type LoopbackAnswerSelection = {
    kind?: string;
    topicIds?: string[];
    scopeCandidateIds?: string[];
    rangeCandidateId?: string | null;
    uncertainty?: string;
};
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Uses the actual advertised joint/default or standalone Explain branch. */
export function createLoopbackAnswerIntake(
    request: unknown,
    selection: LoopbackAnswerSelection = {},
    id = 'intake'
): LoopbackToolCall {
    if (!isRecord(request) || !Array.isArray(request.tools)) {
        throw new Error('Answer fixture needs advertised tools.');
    }
    for (const tool of request.tools) {
        if (!isRecord(tool) || !isRecord(tool.function)) {
            continue;
        }
        const definition = tool.function;
        if (
            !['selectCreativeInterpretation', 'selectAnswerInterpretation'].includes(String(definition.name)) ||
            !isRecord(definition.parameters) ||
            !isRecord(definition.parameters.properties)
        ) {
            continue;
        }
        const catalog = definition.parameters.properties.catalogId;
        if (!isRecord(catalog) || typeof catalog.const !== 'string') {
            continue;
        }
        const answer = {
            kind: 'project-facts',
            topicIds: [],
            scopeCandidateIds: [],
            rangeCandidateId: null,
            uncertainty: 'none',
            ...selection,
        };
        return {
            id,
            name: String(definition.name),
            arguments:
                definition.name === 'selectCreativeInterpretation'
                    ? {
                          catalogId: catalog.const,
                          modeId: 'read-only',
                          targetCandidateIds: [],
                          editDimensionCandidateIds: [],
                          constraintCandidateIds: [],
                          creationSlotIds: [],
                          uncertainty: 'none',
                          answer,
                      }
                    : { catalogId: catalog.const, ...answer },
        };
    }
    throw new Error('Answer fixture did not receive the dynamic intake schema.');
}

/** Dynamic intake followed by a real query and a closed application-composed answer. */
export function createLoopbackAnswerToolCalls(): NonNullable<LoopbackOpenAiProviderOptions['toolCalls']> {
    return [
        (request) => createLoopbackAnswerIntake(request, {}, 'loopback-intake'),
        { id: 'loopback-query', name: 'project_query', arguments: { type: 'project-summary' } },
        {
            id: 'loopback-answer',
            name: 'answer_respond',
            arguments: {
                intakeCallId: 'loopback-intake',
                statements: [
                    { kind: 'project-fact', fact: 'summary' },
                    { kind: 'query-page', callId: 'loopback-query' },
                ],
            },
        },
    ];
}

export type LoopbackOpenAiProvider = {
    /** OpenAI-compatible base URL, e.g. `http://127.0.0.1:41234/v1`. */
    baseUrl: string;
    model: string;
    /** The assistant text this endpoint streams, so a driver waits for what it serves rather than a second literal. */
    reply: string;
    /** Chat-completion request bodies the app sent, in arrival order. */
    completionRequests: readonly string[];
    close: () => Promise<void>;
};

function writeCorsHeaders(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    writeCorsHeaders(response);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) {
            throw new TypeError('Loopback provider received a non-binary request chunk');
        }
        byteLength += chunk.byteLength;
        if (byteLength > MAX_REQUEST_BYTES) {
            throw new Error('Loopback provider request exceeded its 1 MiB limit');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function streamChatCompletion(response: ServerResponse, reply: string): void {
    writeCorsHeaders(response);
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'close',
    });
    const chunk = (choice: Record<string, unknown>): string =>
        `data: ${JSON.stringify({
            id: 'chatcmpl-sourdaw-e2e',
            object: 'chat.completion.chunk',
            model: MODEL_ID,
            choices: [{ index: 0, ...choice }],
        })}\n\n`;
    response.write(chunk({ delta: { role: 'assistant', content: reply } }));
    response.write(chunk({ delta: {}, finish_reason: 'stop' }));
    response.write('data: [DONE]\n\n');
    response.end();
}

function createRequestListener(provider: {
    reply: string;
    completionRequests: string[];
    toolCalls?: LoopbackOpenAiProviderOptions['toolCalls'];
    nextToolCall: number;
}): (request: IncomingMessage, response: ServerResponse) => void {
    return (request, response) => {
        if (request.method === 'OPTIONS') {
            writeCorsHeaders(response);
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method !== 'POST' || request.url !== CHAT_COMPLETIONS_PATH) {
            sendJson(response, 404, {
                error: { message: `Unsupported ${request.method ?? 'request'} ${request.url ?? ''}` },
            });
            return;
        }
        readRequestBody(request)
            .then((body) => {
                provider.completionRequests.push(body);
                const requestBody: unknown = provider.toolCalls === undefined ? null : JSON.parse(body);
                if (
                    provider.toolCalls !== undefined &&
                    typeof requestBody === 'object' &&
                    requestBody !== null &&
                    'stream' in requestBody &&
                    requestBody.stream === false
                ) {
                    const scripted = provider.toolCalls[provider.nextToolCall++];
                    const call = typeof scripted === 'function' ? scripted(requestBody) : scripted;
                    if (call === undefined) {
                        sendJson(response, 500, { error: { message: 'Loopback tool script exhausted' } });
                        return;
                    }
                    sendJson(response, 200, {
                        id: 'chatcmpl-sourdaw-e2e',
                        object: 'chat.completion',
                        model: MODEL_ID,
                        choices: [
                            {
                                index: 0,
                                finish_reason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: null,
                                    tool_calls: [
                                        {
                                            id: call.id,
                                            type: 'function',
                                            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                        },
                                    ],
                                },
                            },
                        ],
                    });
                    return;
                }
                streamChatCompletion(response, provider.reply);
            })
            .catch((error: unknown) => {
                sendJson(response, 413, { error: { message: error instanceof Error ? error.message : 'read failed' } });
            });
    };
}

function listenOnLoopback(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
                reject(new Error('Loopback provider did not bind a TCP port'));
                return;
            }
            resolve(address.port);
        });
    });
}

export async function startLoopbackOpenAiProvider(
    options: LoopbackOpenAiProviderOptions = {}
): Promise<LoopbackOpenAiProvider> {
    const state = {
        reply: options.reply ?? 'Loopback provider reply.',
        completionRequests: [] as string[],
        toolCalls: options.toolCalls,
        nextToolCall: 0,
    };
    const server = createServer(createRequestListener(state));
    const port = await listenOnLoopback(server);
    return {
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        model: MODEL_ID,
        reply: state.reply,
        completionRequests: state.completionRequests,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            }),
    };
}
