import { productionProviderGatewayDependencies, type ProviderGatewayDependencies } from './providerGatewayDependencies';

export async function openProviderGatewaySession(
    adapter: Readonly<{ adapterId: string; origin: string }>,
    credentialSource: 'anthropic' | 'openai' | 'openai-compatible',
    dependencies: ProviderGatewayDependencies = productionProviderGatewayDependencies
): Promise<string> {
    const sessionId = await dependencies.invoke('open_provider_gateway_session', {
        adapterId: adapter.adapterId,
        origin: adapter.origin,
        credentialSource,
    });
    if (typeof sessionId !== 'string' || !/^provider-session-[a-f0-9]{32}$/u.test(sessionId)) {
        throw new Error('Provider gateway returned an invalid credential session');
    }
    return sessionId;
}
