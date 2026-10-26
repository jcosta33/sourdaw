import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type ScriptedToolRequest = {
    model: string;
    stream: false;
    tools: Array<{
        type: 'function';
        function: { name: string; parameters: { properties: Record<string, unknown>; [key: string]: unknown } };
    }>;
    messages: Array<{ role: string; content: string | null; tool_call_id?: string }>;
};

export type ScriptedToolCall = { id: string; name: string; arguments: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRequest(value: unknown): ScriptedToolRequest {
    if (!isRecord(value) || typeof value.model !== 'string' || value.stream !== false) {
        throw new Error('Expected a non-streaming tool request with a model.');
    }
    if (!Array.isArray(value.tools) || value.tools.length === 0 || !Array.isArray(value.messages)) {
        throw new Error('Expected explicit caller-supplied tools and messages.');
    }
    const tools = value.tools.map((tool) => {
        if (
            !isRecord(tool) ||
            tool.type !== 'function' ||
            !isRecord(tool.function) ||
            typeof tool.function.name !== 'string' ||
            !isRecord(tool.function.parameters) ||
            !isRecord(tool.function.parameters.properties)
        ) {
            throw new Error('Invalid provider tool schema.');
        }
        return {
            type: 'function' as const,
            function: {
                name: tool.function.name,
                parameters: { ...tool.function.parameters, properties: tool.function.parameters.properties },
            },
        };
    });
    const messages = value.messages.map((message) => {
        if (
            !isRecord(message) ||
            typeof message.role !== 'string' ||
            (typeof message.content !== 'string' && message.content !== null)
        ) {
            throw new Error('Invalid provider message.');
        }
        return {
            role: message.role,
            content: message.content,
            ...(typeof message.tool_call_id === 'string' ? { tool_call_id: message.tool_call_id } : {}),
        };
    });
    return { model: value.model, stream: false, tools, messages };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) {
            throw new Error('Expected a binary request chunk.');
        }
        size += chunk.byteLength;
        if (size > 1_048_576) {
            throw new Error('Scripted tool request exceeds 1 MiB.');
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

/** A real loopback endpoint; only provider output is scripted, never application planning or writes. */
export async function startScriptedToolProvider(
    respond: (request: ScriptedToolRequest, turn: number) => readonly ScriptedToolCall[]
) {
    const model = 'sourdaw-tool-authority-proof';
    const requests: ScriptedToolRequest[] = [];
    const completionRequests: string[] = [];
    const failures: string[] = [];
    const server = createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        if (request.method === 'OPTIONS') {
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            send(response, 404, { error: { message: 'Unsupported scripted provider request.' } });
            return;
        }
        void readBody(request)
            .then((value) => {
                const parsed = readRequest(value);
                if (parsed.model !== model) {
                    throw new Error('Unexpected provider model.');
                }
                completionRequests.push(JSON.stringify(value));
                const turn = requests.length;
                requests.push(parsed);
                const calls = respond(parsed, turn);
                send(response, 200, {
                    id: `tool-authority-${String(turn)}`,
                    object: 'chat.completion',
                    model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: null,
                                tool_calls: calls.map((call) => ({
                                    id: call.id,
                                    type: 'function',
                                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                })),
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                });
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                failures.push(message);
                send(response, 400, { error: { message } });
            });
    });
    const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
                reject(new Error('Scripted provider did not bind loopback.'));
                return;
            }
            resolve(address.port);
        });
    });
    return {
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        model,
        reply: '',
        completionRequests,
        requests,
        failures,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}
