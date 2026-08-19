import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hostedLlmProviderStatusStore } from '../../../stores/hostedLlmProviderStatusStore';
import { clearCloudProviderConfig } from '../clearCloudProviderConfig';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudProviderConfig } from '../setCloudProviderConfig';

const invoke = vi.hoisted(() =>
    vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(async (command) =>
        command === 'open_provider_gateway_session' ? 'provider-session-00000000000000000000000000000000' : undefined
    )
);

vi.mock('#/utils/desktopBridge', () => ({ isDesktopRuntime: () => true, desktopInvoke: invoke, createChannel: vi.fn() }));

describe('clearCloudProviderConfig', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
        invoke.mockClear();
    });

    it('closes the native session and aborts every active request', async () => {
        await setCloudProviderConfig({ provider: 'anthropic', model: 'claude-test' });
        const first = registerCloudStreamController(new AbortController());
        const second = registerCloudStreamController(new AbortController());

        await clearCloudProviderConfig();

        expect(invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: 'provider-session-00000000000000000000000000000000',
        });
        expect(hostedLlmProviderStatusStore.value).toBeNull();
        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(true);
    });
});
