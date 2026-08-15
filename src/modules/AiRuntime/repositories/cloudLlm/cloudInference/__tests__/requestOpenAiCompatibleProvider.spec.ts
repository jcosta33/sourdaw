import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestOpenAiCompatibleProvider } from '../requestOpenAiCompatibleProvider';

describe('requestOpenAiCompatibleProvider', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
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
                api_key: '',
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
    });
});
