import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeProviderGatewaySession } from '../probeProviderGatewaySession';

const runGateway = vi.hoisted(() => vi.fn());

vi.mock('../providerGateway', () => ({ runProviderGatewayRequest: runGateway }));

const SESSION_ID = 'provider-session-00000000000000000000000000000000';

describe('probeProviderGatewaySession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when the probe returns HTTP 401', async () => {
        runGateway.mockImplementation(async ({ onResponseStart, onBodyChunk }) => {
            onResponseStart({ status: 401, contentType: 'application/json' });
            onBodyChunk(new TextEncoder().encode('{"error":"invalid_api_key"}'));
        });

        await expect(probeProviderGatewaySession(SESSION_ID, new AbortController().signal)).rejects.toThrow(
            'Provider adapter capability probe failed with status 401'
        );
        expect(runGateway).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: SESSION_ID,
                operation: 'probe',
                body: null,
            })
        );
    });

    it('returns the concatenated probe body after a 2xx response', async () => {
        const body = '{"data":[{"id":"gpt-test"}]}';
        runGateway.mockImplementation(async ({ onResponseStart, onBodyChunk }) => {
            onResponseStart({ status: 200, contentType: 'application/json' });
            onBodyChunk(new TextEncoder().encode(body));
        });

        const bytes = await probeProviderGatewaySession(SESSION_ID, new AbortController().signal);
        expect(new TextDecoder().decode(bytes)).toBe(body);
    });
});
