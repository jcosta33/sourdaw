import { describe, expect, it, vi } from 'vitest';

import { normalizeProviderCapabilityProbe } from '../normalizeProviderCapabilityProbe';
import { compileProviderAdapterInstallation, type ProviderAdapterInstallationInput } from '../providerAdapterRegistry';
import { runProviderGatewayRequest, type ProviderGatewayDependencies } from '../providerGateway';

const BASE_INSTALLATION: ProviderAdapterInstallationInput = {
    adapterId: 'builtin.openai-compatible.chat-completions.v1',
    providerId: 'studio-provider',
    modelId: 'studio-model-v1',
    protocolFamily: 'openai-chat-completions',
    origin: 'https://models.example.test:8443',
};

describe('provider adapter conformance', () => {
    it('compiles a stable installed adapter into the privileged provider contract', () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);

        expect(adapter).toMatchObject({
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            providerId: 'studio-provider',
            modelId: 'studio-model-v1',
            protocolFamily: 'openai-chat-completions',
            origin: 'https://models.example.test:8443',
            transport: {
                kind: 'privileged-origin',
                dnsAdmission: 'public-global-only',
                redirects: 'disabled',
                proxy: 'disabled',
            },
        });
        expect(adapter.capabilities).toMatchObject({ text: true, tools: true, streaming: true });
    });

    it.each([
        ['model supplied URL', { ...BASE_INSTALLATION, modelUrl: 'https://evil.example' }],
        ['adapter code', { ...BASE_INSTALLATION, executableCode: 'fetch("https://evil.example")' }],
        ['non-canonical path', { ...BASE_INSTALLATION, origin: 'https://models.example.test/v1' }],
        ['credentials', { ...BASE_INSTALLATION, origin: 'https://secret@models.example.test' }],
        ['private destination', { ...BASE_INSTALLATION, origin: 'https://192.168.1.10:8443' }],
        ['metadata destination', { ...BASE_INSTALLATION, origin: 'https://169.254.169.254' }],
        ['deprecated IPv4 relay', { ...BASE_INSTALLATION, origin: 'https://192.88.99.2' }],
        ['IPv4 documentation range', { ...BASE_INSTALLATION, origin: 'https://198.51.100.1' }],
        ['IPv6 translation space', { ...BASE_INSTALLATION, origin: 'https://[64:ff9b:1::1]' }],
        ['IPv6 discard prefix', { ...BASE_INSTALLATION, origin: 'https://[100::1]' }],
        ['IPv6 documentation prefix', { ...BASE_INSTALLATION, origin: 'https://[3fff::1]' }],
        ['IPv6 segment routing test prefix', { ...BASE_INSTALLATION, origin: 'https://[5f00::1]' }],
        ['unknown adapter', { ...BASE_INSTALLATION, adapterId: 'downloaded.javascript.adapter' }],
    ])('rejects %s before transport', (_label, input) => {
        expect(() => compileProviderAdapterInstallation(input)).toThrow();
    });

    it('normalizes the compiled capability probe and rejects another model', () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        expect(normalizeProviderCapabilityProbe(adapter, { data: [{ id: 'studio-model-v1' }] })).toBe(
            adapter.capabilities
        );
        expect(() => normalizeProviderCapabilityProbe(adapter, { data: [{ id: 'other-model' }] })).toThrow(
            'did not advertise'
        );
    });

    it('uses only the privileged gateway and cancels by request ID', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>();
        let resolveRequest: (() => void) | undefined;
        invoke.mockImplementation((command) => {
            if (command === 'provider_gateway_request') {
                return new Promise<void>((resolve) => {
                    resolveRequest = resolve;
                });
            }
            return Promise.resolve(undefined);
        });
        const channel = { id: 1, onmessage: () => undefined, toJSON: () => '__CHANNEL__:1' };
        const dependencies: ProviderGatewayDependencies = {
            createChannel: async () => channel,
            invoke,
        };
        const controller = new AbortController();
        const pending = runProviderGatewayRequest(
            {
                requestId: 'request-1',
                adapter,
                operation: 'request',
                apiKey: 'secret-not-in-errors',
                body: '{"model":"studio-model-v1"}',
                signal: controller.signal,
                onResponseStart: () => undefined,
                onBodyChunk: () => undefined,
            },
            dependencies
        );
        await vi.waitFor(() => expect(resolveRequest).toBeTypeOf('function'));
        controller.abort();
        resolveRequest?.();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(invoke).toHaveBeenCalledWith('provider_gateway_request', {
            requestId: 'request-1',
            adapterId: 'builtin.openai-compatible.chat-completions.v1',
            origin: 'https://models.example.test:8443',
            operation: 'request',
            apiKey: 'secret-not-in-errors',
            body: '{"model":"studio-model-v1"}',
            onEvent: channel,
        });
        expect(invoke).toHaveBeenCalledWith('cancel_provider_gateway_request', { requestId: 'request-1' });
    });

    it('maps bounded gateway events without exposing provider bodies in failures', async () => {
        const adapter = compileProviderAdapterInstallation(BASE_INSTALLATION);
        const channel = { id: 2, onmessage: (_event: unknown) => undefined, toJSON: () => '__CHANNEL__:2' };
        const invoke = vi.fn<ProviderGatewayDependencies['invoke']>(async (command, args) => {
            if (command === 'provider_gateway_request') {
                const onEvent = args?.onEvent as typeof channel;
                onEvent.onmessage({ event: 'response-start', data: { status: 200, contentType: 'application/json' } });
                onEvent.onmessage({ event: 'body-chunk', data: { bytes: [123, 125] } });
                onEvent.onmessage({ event: 'done' });
            }
        });
        const starts: unknown[] = [];
        const chunks: Uint8Array[] = [];
        await runProviderGatewayRequest(
            {
                requestId: 'request-2',
                adapter,
                operation: 'probe',
                apiKey: 'secret-not-in-errors',
                body: null,
                signal: new AbortController().signal,
                onResponseStart: (response) => starts.push(response),
                onBodyChunk: (chunk) => chunks.push(chunk),
            },
            { createChannel: async () => channel, invoke }
        );
        expect(starts).toEqual([{ status: 200, contentType: 'application/json' }]);
        expect(chunks).toEqual([Uint8Array.from([123, 125])]);

        channel.onmessage = (_event: unknown) => undefined;
        invoke.mockImplementationOnce(async (_command, args) => {
            const onEvent = args?.onEvent as typeof channel;
            onEvent.onmessage({ event: 'body-chunk', data: { bytes: [999] } });
        });
        const failed = runProviderGatewayRequest(
            {
                requestId: 'request-3',
                adapter,
                operation: 'request',
                apiKey: 'secret-not-in-errors',
                body: '{"private":"request-body"}',
                signal: new AbortController().signal,
                onResponseStart: () => undefined,
                onBodyChunk: () => undefined,
            },
            { createChannel: async () => channel, invoke }
        );
        await expect(failed).rejects.toThrow('invalid body chunk');
        await expect(failed.catch((error: unknown) => String(error))).resolves.not.toMatch(
            /secret-not-in-errors|request-body/u
        );
    });
});
