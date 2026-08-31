import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hostedLlmProviderStatusStore } from '../../../stores/hostedLlmProviderStatusStore';
import { clearCloudProviderConfig } from '../clearCloudProviderConfig';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudProviderConfig } from '../setCloudProviderConfig';

type TestGatewayChannel = {
    id: number;
    onmessage: (event: unknown) => void;
    toJSON: () => string;
};

const SESSION_ID = 'provider-session-00000000000000000000000000000000';

const invoke = vi.hoisted(() => {
    const channels: TestGatewayChannel[] = [];
    let nextChannelId = 100;
    return {
        channels,
        createChannel: vi.fn(async () => {
            const id = nextChannelId;
            nextChannelId += 1;
            const channel: TestGatewayChannel = {
                id,
                onmessage: (_event: unknown) => undefined,
                toJSON: () => `__CHANNEL__:${String(id)}`,
            };
            channels.push(channel);
            return channel;
        }),
        invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    };
});

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => true,
    desktopInvoke: invoke.invoke,
    createChannel: invoke.createChannel,
}));

function gatewayEvent(
    requestId: unknown,
    sequence: number,
    event: string,
    data: Record<string, unknown> = {}
): Record<string, unknown> {
    return { event, data: { ...data, requestId, sequence } };
}

function mockSuccessfulGateway(): void {
    invoke.invoke.mockImplementation(async (command, args) => {
        if (command === 'open_provider_gateway_session') {
            return SESSION_ID;
        }
        if (command === 'provider_gateway_request') {
            const channelValue = args?.onEvent;
            if (
                typeof channelValue !== 'object' ||
                channelValue === null ||
                !('onmessage' in channelValue) ||
                typeof channelValue.onmessage !== 'function'
            ) {
                throw new Error('Expected a provider gateway event channel');
            }
            const channel = channelValue as TestGatewayChannel;
            const encoder = new TextEncoder();
            let sequence = 0;
            channel.onmessage(
                gatewayEvent(args?.requestId, sequence++, 'response-start', {
                    status: 200,
                    contentType: 'application/json',
                })
            );
            channel.onmessage(
                gatewayEvent(args?.requestId, sequence++, 'body-chunk', {
                    bytes: Array.from(encoder.encode('{"data":[]}')),
                })
            );
            channel.onmessage(gatewayEvent(args?.requestId, sequence, 'done'));
            return undefined;
        }
        return undefined;
    });
}

describe('clearCloudProviderConfig', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
        vi.clearAllMocks();
        invoke.channels.length = 0;
        mockSuccessfulGateway();
    });

    it('closes the native session and aborts every active request', async () => {
        await setCloudProviderConfig({
            provider: 'anthropic',
            model: 'claude-test',
            authentication: 'api-key',
            apiKey: 'sk-anthropic-test',
        });
        const first = registerCloudStreamController(new AbortController());
        const second = registerCloudStreamController(new AbortController());

        await clearCloudProviderConfig();

        expect(invoke.invoke).toHaveBeenCalledWith('close_provider_gateway_session', {
            sessionId: SESSION_ID,
        });
        expect(hostedLlmProviderStatusStore.value).toBeNull();
        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(true);
    });
});
