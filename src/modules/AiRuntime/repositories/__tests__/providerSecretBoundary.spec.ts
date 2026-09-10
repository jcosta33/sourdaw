import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRunStore } from '../../stores/agentRunStore';
import { aiActionHistoryStore } from '../../stores/aiActionHistoryStore';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { chatStore } from '../../stores/chatStore';
import { hostedLlmProviderStatusStore } from '../../stores/hostedLlmProviderStatusStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { mixAnalysisStore } from '../../stores/mixAnalysisStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { voiceInputAvailabilityStore } from '../../stores/voiceInputAvailabilityStore';
import { voiceStatusStore } from '../../stores/voiceStatusStore';
import { clearCloudProviderConfig } from '../cloudLlm/clearCloudProviderConfig';
import { cloudSession } from '../cloudLlm/cloudSession';
import { setCloudProviderConfig } from '../cloudLlm/setCloudProviderConfig';
import { MAX_PROVIDER_CREDENTIAL_BYTES, openProviderGatewaySession } from '../openProviderGatewaySession';

type TestGatewayChannel = {
    id: number;
    onmessage: (event: unknown) => void;
    toJSON: () => string;
};

/**
 * A literal no production path may ever echo. Every observable surface below is
 * stringified and searched for it, so a leak fails by content rather than by an
 * enumerated key name a future field could sidestep.
 */
const CREDENTIAL = 'sk-fixture-SECRET-000000000000000000000000';
const SESSION_ID = 'provider-session-0123456789abcdef0123456789abcdef';
const ANTHROPIC_ADAPTER = Object.freeze({
    adapterId: 'builtin.anthropic.messages.v1',
    origin: 'https://api.anthropic.com',
});

const mocks = vi.hoisted(() => {
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
        isDesktopRuntime: vi.fn(() => true),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };
});

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: mocks.isDesktopRuntime,
    desktopInvoke: mocks.invoke,
    createChannel: mocks.createChannel,
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: mocks.debug, error: mocks.error, info: mocks.info, warn: mocks.warn },
}));

/**
 * Every AiRuntime store module that owns a snapshot. `engineInitializationState`
 * (one `AbortController`) and `mixAnalysisRunRegistry` (one run counter) hold no
 * snapshot and are excluded; the two `select*` modules are projections, not stores.
 */
const aiRuntimeStores = {
    agentRunStore,
    aiActionHistoryStore,
    aiBackendPreferenceStore,
    chatStore,
    hostedLlmProviderStatusStore,
    llmStatusStore,
    mixAnalysisStore,
    pendingActionConfirmationStore,
    voiceInputAvailabilityStore,
    voiceStatusStore,
};

function containsCredential(value: unknown): boolean {
    return JSON.stringify(value ?? null)?.includes(CREDENTIAL) === true;
}

function collectKeys(value: unknown, seen = new Set<object>()): string[] {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return [];
    }
    seen.add(value);
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested, seen)]);
}

function emitProbeResponse(channel: TestGatewayChannel, requestId: unknown, status: number, body: string): void {
    const encoder = new TextEncoder();
    let sequence = 0;
    const event = (name: string, data: Record<string, unknown> = {}): Record<string, unknown> => ({
        event: name,
        data: { ...data, requestId, sequence: sequence++ },
    });
    channel.onmessage(event('response-start', { status, contentType: 'application/json' }));
    channel.onmessage(event('body-chunk', { bytes: Array.from(encoder.encode(body)) }));
    channel.onmessage(event('done'));
}

function mockProviderGateway(sessionId: string = SESSION_ID): void {
    mocks.invoke.mockImplementation(async (command, args) => {
        if (command === 'open_provider_gateway_session') {
            return sessionId;
        }
        if (command === 'provider_gateway_request') {
            const channel = args?.onEvent;
            if (typeof channel !== 'object' || channel === null || !('onmessage' in channel)) {
                throw new Error('Expected a provider gateway event channel');
            }
            emitProbeResponse(channel as TestGatewayChannel, args?.requestId, 200, '{"data":[]}');
            return undefined;
        }
        return undefined;
    });
}

describe('provider credential boundary', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
        vi.clearAllMocks();
        mocks.channels.length = 0;
        mocks.isDesktopRuntime.mockReturnValue(true);
        mockProviderGateway();
        localStorage.clear();
    });

    afterEach(async () => {
        mockProviderGateway();
        await clearCloudProviderConfig();
        localStorage.clear();
    });

    describe('openProviderGatewaySession', () => {
        it('carries the credential on open_provider_gateway_session and nothing else', async () => {
            const sessionId = await openProviderGatewaySession(ANTHROPIC_ADAPTER, 'anthropic', CREDENTIAL);

            expect(sessionId).toMatch(/^provider-session-[a-f0-9]{32}$/u);
            expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('open_provider_gateway_session', {
                adapterId: ANTHROPIC_ADAPTER.adapterId,
                origin: ANTHROPIC_ADAPTER.origin,
                credentialSource: 'anthropic',
                credential: CREDENTIAL,
            });
            expect(sessionId.includes(CREDENTIAL)).toBe(false);
        });

        it('refuses a session id that is not an opaque 32-hex handle', async () => {
            for (const malformed of [
                'provider-session-not-hex',
                'provider-session-0123456789ABCDEF0123456789ABCDEF',
                `provider-session-0123456789abcdef0123456789abcdef${CREDENTIAL}`,
                SESSION_ID.slice(0, -1),
                CREDENTIAL,
            ]) {
                mocks.invoke.mockResolvedValueOnce(malformed);
                await expect(openProviderGatewaySession(ANTHROPIC_ADAPTER, 'anthropic', CREDENTIAL)).rejects.toThrow(
                    'Provider gateway returned an invalid credential session'
                );
            }
        });

        it('refuses an oversize credential before any IPC leaves the renderer', async () => {
            const oversize = 'é'.repeat(MAX_PROVIDER_CREDENTIAL_BYTES / 2 + 1);

            await expect(openProviderGatewaySession(ANTHROPIC_ADAPTER, 'anthropic', oversize)).rejects.toThrow(
                'Provider gateway credential exceeds its size limit'
            );
            expect(mocks.invoke).not.toHaveBeenCalled();
        });
    });

    describe('setCloudProviderConfig', () => {
        it('leaves the credential in no observable surface once Anthropic is configured', async () => {
            const indexedDbOpen =
                typeof indexedDB === 'undefined'
                    ? null
                    : vi.spyOn(indexedDB, 'open').mockImplementation(() => {
                          throw new Error('indexedDB.open must not be reached by provider configuration');
                      });
            try {
                await setCloudProviderConfig({
                    provider: 'anthropic',
                    model: 'claude-test',
                    authentication: 'api-key',
                    apiKey: CREDENTIAL,
                });

                for (const [name, store] of Object.entries(aiRuntimeStores)) {
                    expect(containsCredential(store.value), `${name} retained the credential`).toBe(false);
                }

                const storedKeys = Object.keys(localStorage);
                for (const key of storedKeys) {
                    expect(containsCredential(key)).toBe(false);
                    expect(containsCredential(localStorage.getItem(key)), `${key} retained the credential`).toBe(false);
                }
                expect(indexedDbOpen?.mock.calls.length ?? 0).toBe(0);

                for (const logCall of [
                    ...mocks.debug.mock.calls,
                    ...mocks.error.mock.calls,
                    ...mocks.info.mock.calls,
                    ...mocks.warn.mock.calls,
                ]) {
                    expect(containsCredential(logCall)).toBe(false);
                }

                const credentialCarryingCommands = mocks.invoke.mock.calls
                    .filter(([, args]) => containsCredential(args))
                    .map(([command]) => command);
                expect(credentialCarryingCommands).toEqual(['open_provider_gateway_session']);

                const runtime = cloudSession.get_runtime();
                expect(runtime).toMatchObject({ provider: 'anthropic', session_id: SESSION_ID });
                expect(containsCredential(runtime)).toBe(false);
                const runtimeKeys = collectKeys(runtime);
                expect(runtimeKeys).toContain('session_id');
                expect(runtimeKeys).not.toContain('apiKey');
                expect(runtimeKeys).not.toContain('credential');
                expect(runtimeKeys).not.toContain('authorization');
            } finally {
                indexedDbOpen?.mockRestore();
            }
        });
    });

    describe('standalone browser runtime', () => {
        beforeEach(() => {
            mocks.isDesktopRuntime.mockReturnValue(false);
        });

        it('refuses Anthropic configuration without reaching the desktop bridge', async () => {
            await expect(
                setCloudProviderConfig({
                    provider: 'anthropic',
                    model: 'claude-test',
                    authentication: 'api-key',
                    apiKey: CREDENTIAL,
                })
            ).rejects.toThrow('Hosted providers are available in desktop builds only');
            expect(mocks.invoke).not.toHaveBeenCalled();
        });

        it('refuses an authenticated HTTPS openai-compatible endpoint without reaching the desktop bridge', async () => {
            await expect(
                setCloudProviderConfig({
                    provider: 'openai-compatible',
                    model: 'custom-model',
                    baseUrl: 'https://models.example.test/v1',
                    authentication: 'api-key',
                    apiKey: CREDENTIAL,
                })
            ).rejects.toThrow('Hosted providers are available in desktop builds only');
            expect(mocks.invoke).not.toHaveBeenCalled();
        });
    });
});
