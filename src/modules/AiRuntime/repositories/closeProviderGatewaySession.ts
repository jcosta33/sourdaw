import { productionProviderGatewayDependencies, type ProviderGatewayDependencies } from './providerGatewayDependencies';

export async function closeProviderGatewaySession(
    sessionId: string,
    dependencies: ProviderGatewayDependencies = productionProviderGatewayDependencies
): Promise<void> {
    await dependencies.invoke('close_provider_gateway_session', { sessionId });
}
