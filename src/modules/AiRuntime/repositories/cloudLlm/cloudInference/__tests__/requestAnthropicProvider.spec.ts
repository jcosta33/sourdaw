import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestAnthropicProvider } from '../requestAnthropicProvider';

const runGateway = vi.hoisted(() => vi.fn());

vi.mock('../../../providerGateway', () => ({ runProviderGatewayRequest: runGateway }));

function input(onBodyChunk = vi.fn()) {
    return {
        sessionId: 'provider-session-00000000000000000000000000000000',
        body: '{}',
        signal: new AbortController().signal,
        onBodyChunk,
    };
}

describe('requestAnthropicProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards successful response bytes', async () => {
        runGateway.mockImplementation(async ({ onResponseStart, onBodyChunk }) => {
            onResponseStart({ status: 200, contentType: 'application/json' });
            onBodyChunk(Uint8Array.of(1, 2, 3));
        });
        const onBodyChunk = vi.fn();

        await expect(requestAnthropicProvider(input(onBodyChunk))).resolves.toEqual({
            status: 200,
            contentType: 'application/json',
        });
        expect(onBodyChunk).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3));
    });

    it('drops provider error bodies', async () => {
        runGateway.mockImplementation(async ({ onResponseStart, onBodyChunk }) => {
            onResponseStart({ status: 401, contentType: 'application/json' });
            onBodyChunk(new TextEncoder().encode('private provider detail'));
        });
        const onBodyChunk = vi.fn();

        await expect(requestAnthropicProvider(input(onBodyChunk))).resolves.toEqual({
            status: 401,
            contentType: 'application/json',
        });
        expect(onBodyChunk).not.toHaveBeenCalled();
    });
});
