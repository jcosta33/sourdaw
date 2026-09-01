import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileProviderAdapterInstallation } from '../../../providerAdapterRegistry';
import { requestOpenAiCompatibleProvider } from '../requestOpenAiCompatibleProvider';

const runGateway = vi.hoisted(() => vi.fn());

vi.mock('../../../providerGateway', () => ({ runProviderGatewayRequest: runGateway }));

const SESSION_ID = 'provider-session-00000000000000000000000000000000';

function createAdapterRuntime() {
    return {
        provider: 'openai-compatible' as const,
        authentication: 'api-key' as const,
        session_id: SESSION_ID,
        model: 'studio-model-v1',
        base_url: 'https://models.example.test:8443/v1',
        adapter: compileProviderAdapterInstallation({
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            providerId: 'studio-provider',
            modelId: 'studio-model-v1',
            protocolFamily: 'openai-chat-completions',
            origin: 'https://models.example.test:8443',
        }),
    };
}

describe('requestOpenAiCompatibleProvider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('cancels a direct non-OK response body before returning its status', async () => {
        const cancel = vi.fn();
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(new ReadableStream<Uint8Array>({ cancel }), {
                status: 503,
                headers: { 'content-type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);
        const onBodyChunk = vi.fn();

        const response = await requestOpenAiCompatibleProvider({
            runtime: {
                provider: 'openai-compatible',
                authentication: 'none',
                session_id: null,
                model: 'local-model',
                base_url: 'http://127.0.0.1:1234/v1',
                adapter: null,
            },
            body: '{}',
            signal: new AbortController().signal,
            onBodyChunk,
        });

        expect(response.status).toBe(503);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(onBodyChunk).not.toHaveBeenCalled();
        expect(runGateway).not.toHaveBeenCalled();
    });

    it('probes adapter capabilities before the first privileged request and skips later probes', async () => {
        const runtime = createAdapterRuntime();
        runGateway.mockImplementation(async ({ operation, onResponseStart, onBodyChunk }) => {
            if (operation === 'probe') {
                onResponseStart({ status: 200, contentType: 'application/json' });
                onBodyChunk(new TextEncoder().encode('{"data":[{"id":"studio-model-v1"}]}'));
                return;
            }
            onResponseStart({ status: 200, contentType: 'application/json' });
            onBodyChunk(Uint8Array.of(1, 2, 3));
        });
        const onBodyChunk = vi.fn();
        const input = {
            runtime,
            body: '{}',
            signal: new AbortController().signal,
            onBodyChunk,
        };

        await expect(requestOpenAiCompatibleProvider(input)).resolves.toEqual({
            status: 200,
            contentType: 'application/json',
        });
        await expect(requestOpenAiCompatibleProvider(input)).resolves.toEqual({
            status: 200,
            contentType: 'application/json',
        });

        expect(runGateway.mock.calls.map(([request]) => request.operation)).toEqual(['probe', 'request', 'request']);
        expect(onBodyChunk).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
        expect(onBodyChunk).toHaveBeenCalledTimes(2);
    });

    it('does not send the privileged request when the capability probe returns 401', async () => {
        const runtime = createAdapterRuntime();
        runGateway.mockImplementation(async ({ operation, onResponseStart, onBodyChunk }) => {
            if (operation !== 'probe') {
                throw new Error('privileged request must not run after a failed probe');
            }
            onResponseStart({ status: 401, contentType: 'application/json' });
            onBodyChunk(new TextEncoder().encode('{"error":"invalid_api_key"}'));
        });

        await expect(
            requestOpenAiCompatibleProvider({
                runtime,
                body: '{}',
                signal: new AbortController().signal,
                onBodyChunk: vi.fn(),
            })
        ).rejects.toThrow('Provider adapter capability probe failed with status 401');
        expect(runGateway.mock.calls.map(([request]) => request.operation)).toEqual(['probe']);
    });
});
