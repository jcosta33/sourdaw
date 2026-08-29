import { productionProviderGatewayDependencies, type ProviderGatewayDependencies } from './providerGatewayDependencies';

export const MAX_PROVIDER_CREDENTIAL_BYTES = 16 * 1024;

export async function openProviderGatewaySession(
    adapter: Readonly<{ adapterId: string; origin: string }>,
    credentialSource: 'anthropic' | 'openai' | 'openai-compatible',
    credential: string,
    dependencies: ProviderGatewayDependencies = productionProviderGatewayDependencies
): Promise<string> {
    if (new TextEncoder().encode(credential).byteLength > MAX_PROVIDER_CREDENTIAL_BYTES) {
        throw new Error('Provider gateway credential exceeds its size limit');
    }
    const sessionId = await dependencies.invoke('open_provider_gateway_session', {
        adapterId: adapter.adapterId,
        origin: adapter.origin,
        credentialSource,
        credential,
    });
    if (typeof sessionId !== 'string' || !/^provider-session-[a-f0-9]{32}$/u.test(sessionId)) {
        throw new Error('Provider gateway returned an invalid credential session');
    }
    return sessionId;
}
