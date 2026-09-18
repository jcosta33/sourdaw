import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

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
 * A literal no production path may ever echo, including a base64 or hex copy a
 * serializer might produce instead of the raw bytes. Every observable surface
 * below is walked recursively and searched for it, so a leak fails by content
 * rather than by an enumerated key name a future field could sidestep.
 */
const CREDENTIAL = 'sk-fixture-SECRET-000000000000000000000000';
const CREDENTIAL_BASE64 = btoa(CREDENTIAL);
const CREDENTIAL_HEX = hex(CREDENTIAL);
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

function hex(text: string): string {
    return Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function matchesCredential(text: string): boolean {
    return text.includes(CREDENTIAL) || text.includes(CREDENTIAL_BASE64) || text.toLowerCase().includes(CREDENTIAL_HEX);
}

function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function isArrayBuffer(value: object): value is ArrayBuffer {
    // `instanceof ArrayBuffer` fails for a buffer minted in another realm (jsdom's
    // `TextEncoder` returns one); the `[[Class]]` tag is realm-independent.
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function toUint8Array(buffer: ArrayBuffer | ArrayBufferView): Uint8Array {
    return isArrayBuffer(buffer)
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Recursively walks strings, byte buffers and views, arrays, Maps, Sets and
 * plain objects for the credential in any of its matched forms. A flat
 * `JSON.stringify(value).includes(CREDENTIAL)` sweep has two blind spots this
 * walk closes: an encoded (base64 or hex) copy of the key passes a literal
 * substring test, and `JSON.stringify` renders a `Uint8Array` as an
 * index-keyed object and an `ArrayBuffer` as `{}`, hiding binary IndexedDB
 * records that hold the key bytes. `Blob` is deliberately not decoded: every
 * call site below is synchronous and only `Blob.text()` is async, and no
 * production path in this module stores the credential as a `Blob`.
 */
function containsCredential(value: unknown, seen = new Set<object>()): boolean {
    if (typeof value === 'string') {
        return matchesCredential(value);
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return false;
    }
    seen.add(value);
    if (isArrayBuffer(value) || ArrayBuffer.isView(value)) {
        return matchesCredential(decodeUtf8(toUint8Array(value)));
    }
    if (Array.isArray(value)) {
        return value.some((item) => containsCredential(item, seen));
    }
    if (value instanceof Map) {
        return Array.from(value.entries()).some(
            ([key, nested]) => containsCredential(key, seen) || containsCredential(nested, seen)
        );
    }
    if (value instanceof Set) {
        return Array.from(value.values()).some((item) => containsCredential(item, seen));
    }
    return Object.values(value).some((nested) => containsCredential(nested, seen));
}

function collectKeys(value: unknown, seen = new Set<object>()): string[] {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return [];
    }
    seen.add(value);
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested, seen)]);
}

function requestToPromise<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
    });
}

/**
 * Enumerates every IndexedDB database the transactional fixture knows about and
 * reads every object store record in each, so the credential is proven absent
 * from persisted IndexedDB state rather than merely absent from an untouched
 * factory. `indexedDB.databases()` is the enumeration API; the fixture installs
 * a real `fake-indexeddb` factory that implements it.
 */
async function assertNoIndexedDbDatabaseRetainsCredential(): Promise<void> {
    const databases = await indexedDB.databases();
    for (const { name } of databases) {
        if (!name) {
            continue;
        }
        const database = await requestToPromise(indexedDB.open(name));
        try {
            for (const storeName of Array.from(database.objectStoreNames)) {
                const transaction = database.transaction(storeName, 'readonly');
                const records = await requestToPromise(transaction.objectStore(storeName).getAll());
                expect(containsCredential(records), `${name}/${storeName} retained the credential`).toBe(false);
            }
        } finally {
            database.close();
        }
    }
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

function mockProviderGateway(sessionId: string = SESSION_ID, probeBody: string = '{"data":[]}'): void {
    mocks.invoke.mockImplementation(async (command, args) => {
        if (command === 'open_provider_gateway_session') {
            return sessionId;
        }
        if (command === 'provider_gateway_request') {
            const channel = args?.onEvent;
            if (typeof channel !== 'object' || channel === null || !('onmessage' in channel)) {
                throw new Error('Expected a provider gateway event channel');
            }
            emitProbeResponse(channel as TestGatewayChannel, args?.requestId, 200, probeBody);
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
        let indexedDbInstallation: TransactionalIndexedDbInstallation | null = null;

        beforeEach(() => {
            indexedDbInstallation = installTransactionalIndexedDb();
        });

        afterEach(async () => {
            await indexedDbInstallation?.dispose();
            indexedDbInstallation = null;
        });

        it('leaves the credential in no observable surface once Anthropic is configured', async () => {
            // Precondition: the fixture installed a real IndexedDB global. Without
            // this, a jsdom-only run would make every assertion below vacuous, the
            // way it silently was before this fixture existed.
            expect(typeof indexedDB).toBe('object');
            const indexedDbOpen = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
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
                expect(indexedDbOpen.mock.calls.length).toBe(0);

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
                indexedDbOpen.mockRestore();
            }

            await assertNoIndexedDbDatabaseRetainsCredential();
        });

        it('refuses a base URL that embeds credentials before any gateway session or store write', async () => {
            // Issue #4161: a pasted `https://user:secret@host/v1` used to park the
            // secret in the `cloudSession` runtime and the
            // `hostedLlmProviderStatusStore` badge data even though the gateway only
            // ever receives the origin. The repository must refuse the configuration
            // outright, so no write path can retain the credential in any form.
            // The probe advertises the model so that, were the refusal removed, the
            // full write path would run.
            mockProviderGateway(SESSION_ID, '{"data":[{"id":"custom-model"}]}');
            const refusal = await setCloudProviderConfig({
                provider: 'openai-compatible',
                model: 'custom-model',
                baseUrl: `https://user:${CREDENTIAL}@models.example.test/v1`,
                authentication: 'api-key',
                apiKey: 'sk-test-key',
            }).then(
                () => null,
                (error: unknown) => error
            );

            // The credential sweep leads so a regression that drops the refusal reds
            // on the leak itself rather than only on the missing rejection.
            for (const [name, store] of Object.entries(aiRuntimeStores)) {
                expect(containsCredential(store.value), `${name} retained the credential`).toBe(false);
            }
            expect(containsCredential(cloudSession.get_runtime())).toBe(false);

            expect(refusal).toBeInstanceOf(Error);
            expect(refusal).toHaveProperty(
                'message',
                'OpenAI-compatible provider base URL cannot include embedded credentials'
            );
            expect(cloudSession.get_runtime()).toBeNull();
            expect(hostedLlmProviderStatusStore.value).toBeNull();
            expect(mocks.invoke).not.toHaveBeenCalledWith('open_provider_gateway_session', expect.anything());
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

describe('containsCredential', () => {
    it('matches base64 and hex copies of the credential', () => {
        expect(containsCredential(btoa(CREDENTIAL))).toBe(true);
        expect(containsCredential(hex(CREDENTIAL))).toBe(true);
    });

    it('matches the credential decoded from a UTF-8 byte view, including one nested in a plain object', () => {
        expect(containsCredential(new TextEncoder().encode(CREDENTIAL))).toBe(true);
        expect(containsCredential({ nested: [new TextEncoder().encode(CREDENTIAL).buffer] })).toBe(true);
    });

    it('does not flag an unrelated string or unrelated binary data', () => {
        expect(containsCredential('unrelated')).toBe(false);
        expect(containsCredential(new Uint8Array([1, 2, 3]))).toBe(false);
    });
});
