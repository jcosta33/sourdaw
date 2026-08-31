import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAdapterCapabilities } from '../ensureAdapterCapabilities';
import { compileProviderAdapterInstallation } from '../providerAdapterRegistry';

const probe = vi.hoisted(() => vi.fn());

vi.mock('../probeProviderGatewaySession', () => ({ probeProviderGatewaySession: probe }));

const SESSION_ID = 'provider-session-00000000000000000000000000000000';

function createAdapter() {
    return compileProviderAdapterInstallation({
        adapterId: 'builtin.openai-compatible.chat-completions.v1',
        providerId: 'studio-provider',
        modelId: 'studio-model-v1',
        protocolFamily: 'openai-chat-completions',
        origin: 'https://models.example.test:8443',
    });
}

describe('ensureAdapterCapabilities', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        probe.mockReset();
    });

    it('probes once for a given adapter and skips later calls', async () => {
        const adapter = createAdapter();
        probe.mockResolvedValue(new TextEncoder().encode('{"data":[{"id":"studio-model-v1"}]}'));
        const signal = new AbortController().signal;

        await ensureAdapterCapabilities(adapter, SESSION_ID, signal);
        await ensureAdapterCapabilities(adapter, SESSION_ID, signal);

        expect(probe).toHaveBeenCalledTimes(1);
        expect(probe).toHaveBeenCalledWith(SESSION_ID, signal);
    });

    it('does not memoize an adapter whose probe fails', async () => {
        const adapter = createAdapter();
        probe.mockRejectedValueOnce(new Error('Provider adapter capability probe failed with status 401'));
        probe.mockResolvedValue(new TextEncoder().encode('{"data":[{"id":"studio-model-v1"}]}'));

        await expect(ensureAdapterCapabilities(adapter, SESSION_ID, new AbortController().signal)).rejects.toThrow(
            'status 401'
        );
        await expect(
            ensureAdapterCapabilities(adapter, SESSION_ID, new AbortController().signal)
        ).resolves.toBeUndefined();
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('rejects a probe that does not advertise the configured model', async () => {
        const adapter = createAdapter();
        probe.mockResolvedValue(new TextEncoder().encode('{"data":[{"id":"other-model"}]}'));

        await expect(ensureAdapterCapabilities(adapter, SESSION_ID, new AbortController().signal)).rejects.toThrow(
            'did not advertise the configured model'
        );
        expect(probe).toHaveBeenCalledTimes(1);
    });
});
