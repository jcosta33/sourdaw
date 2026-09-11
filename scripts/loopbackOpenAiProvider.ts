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

type LoopbackOpenAiProviderOptions = {
    /** Assistant text the endpoint streams back for every chat completion. */
    reply?: string;
};

export type LoopbackOpenAiProvider = {
    /** OpenAI-compatible base URL, e.g. `http://127.0.0.1:41234/v1`. */
    baseUrl: string;
    model: string;
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
    const state = { reply: options.reply ?? 'Loopback provider reply.', completionRequests: [] as string[] };
    const server = createServer(createRequestListener(state));
    const port = await listenOnLoopback(server);
    return {
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        model: MODEL_ID,
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
