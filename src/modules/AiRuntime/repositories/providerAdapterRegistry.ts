import { type ModelProviderCapabilities } from '../models/ModelProviderProtocol';

export const PROVIDER_ADAPTER_SCHEMA_VERSION = 1 as const;

export type ProviderProtocolFamily = 'openai-chat-completions';

export type ProviderAdapterInstallationInput = {
    adapterId: string;
    providerId: string;
    modelId: string;
    protocolFamily: ProviderProtocolFamily;
    origin: string;
};

export type CompiledProviderAdapter = Readonly<{
    schemaVersion: typeof PROVIDER_ADAPTER_SCHEMA_VERSION;
    adapterId: 'builtin.openai-compatible.chat-completions.v1';
    providerId: string;
    modelId: string;
    protocolFamily: 'openai-chat-completions';
    origin: string;
    requestPath: '/v1/chat/completions';
    probePath: '/v1/models';
    transport: Readonly<{
        kind: 'privileged-origin';
        dnsAdmission: 'public-global-only';
        redirects: 'disabled';
        proxy: 'disabled';
    }>;
    capabilities: ModelProviderCapabilities;
    retry: Readonly<{ maxAttempts: 1; retryableStatuses: readonly [408, 429, 500, 502, 503, 504] }>;
    redaction: Readonly<{
        credentials: 'omit';
        requestBody: 'omit';
        providerErrors: 'safe-summary-only';
    }>;
}>;

const INSTALLATION_KEYS = new Set(['adapterId', 'providerId', 'modelId', 'protocolFamily', 'origin']);
const STABLE_PROVIDER_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const STABLE_MODEL_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,254}[A-Za-z0-9])?$/u;

const OPENAI_COMPATIBLE_CAPABILITIES: ModelProviderCapabilities = Object.freeze({
    text: true,
    tools: true,
    structuredOutput: false,
    parallelToolCalls: false,
    streaming: true,
    contextWindowTokens: null,
    maxOutputTokens: null,
    cacheControls: ['provider-default'] as const,
    reasoningControls: ['provider-default'] as const,
    dataPolicies: ['remote-allowed'] as const,
    media: { audio: 'unavailable', image: 'unavailable', video: 'unavailable' } as const,
});

function assertExactInstallationShape(input: ProviderAdapterInstallationInput): void {
    for (const key of Object.keys(input)) {
        if (!INSTALLATION_KEYS.has(key)) {
            throw new Error(`Provider adapter installation contains unsupported field: ${key}`);
        }
    }
}

function assertStableId(label: string, value: string, pattern: RegExp): string {
    const normalized = value.trim();
    if (!pattern.test(normalized) || normalized.includes('://')) {
        throw new Error(`${label} must be a stable identifier`);
    }
    return normalized;
}

function isRejectedIpv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) {
        return false;
    }
    const bytes = parts.map(Number);
    if (bytes.some((part) => part > 255)) {
        throw new Error('Provider adapter origin contains an invalid IPv4 address');
    }
    const a = bytes[0] ?? 256;
    const b = bytes[1] ?? 256;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}

function compileCanonicalPublicOrigin(value: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error('Provider adapter origin is invalid');
    }
    if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        value !== parsed.origin
    ) {
        throw new Error('Provider adapter origin must be a canonical HTTPS host-and-port origin');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname === '[::]' ||
        hostname === '[::1]' ||
        hostname.startsWith('[fc') ||
        hostname.startsWith('[fd') ||
        hostname.startsWith('[fe8') ||
        hostname.startsWith('[fe9') ||
        hostname.startsWith('[fea') ||
        hostname.startsWith('[feb') ||
        isRejectedIpv4(hostname)
    ) {
        throw new Error('Provider adapter origin must resolve only to public global addresses');
    }
    return parsed.origin;
}

export function compileProviderAdapterInstallation(input: ProviderAdapterInstallationInput): CompiledProviderAdapter {
    assertExactInstallationShape(input);
    if (input.adapterId !== 'builtin.openai-compatible.chat-completions.v1') {
        throw new Error('Provider adapter is not compiled into this release or explicitly installed');
    }
    if (input.protocolFamily !== 'openai-chat-completions') {
        throw new Error('Provider adapter protocol family does not match its compiled contract');
    }

    return Object.freeze({
        schemaVersion: PROVIDER_ADAPTER_SCHEMA_VERSION,
        adapterId: input.adapterId,
        providerId: assertStableId('Provider ID', input.providerId, STABLE_PROVIDER_ID),
        modelId: assertStableId('Model ID', input.modelId, STABLE_MODEL_ID),
        protocolFamily: input.protocolFamily,
        origin: compileCanonicalPublicOrigin(input.origin),
        requestPath: '/v1/chat/completions',
        probePath: '/v1/models',
        transport: Object.freeze({
            kind: 'privileged-origin' as const,
            dnsAdmission: 'public-global-only' as const,
            redirects: 'disabled' as const,
            proxy: 'disabled' as const,
        }),
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
        retry: Object.freeze({
            maxAttempts: 1 as const,
            retryableStatuses: [408, 429, 500, 502, 503, 504] as const,
        }),
        redaction: Object.freeze({
            credentials: 'omit' as const,
            requestBody: 'omit' as const,
            providerErrors: 'safe-summary-only' as const,
        }),
    });
}
