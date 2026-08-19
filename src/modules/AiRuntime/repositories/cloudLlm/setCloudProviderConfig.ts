import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopBridge';

import { type HostedLlmConfiguration } from '../../models/HostedLlmProvider';
import { openProviderGatewaySession } from '../openProviderGatewaySession';
import { compileProviderAdapterInstallation } from '../providerAdapterRegistry';

import { cloudSession, type CloudProviderRuntime } from './cloudSession';

const ANTHROPIC_PROVIDER_ADAPTER = Object.freeze({
    adapterId: 'builtin.anthropic.messages.v1' as const,
    origin: 'https://api.anthropic.com' as const,
});

export const setCloudProviderConfig = inject({ logger })(
    ({ logger }) =>
        async function setCloudProviderConfig(configuration: HostedLlmConfiguration): Promise<void> {
            let runtime: CloudProviderRuntime;
            if (configuration.provider === 'anthropic') {
                if (!isDesktopRuntime()) {
                    throw new Error('Hosted providers are available in desktop builds only');
                }
                runtime = {
                    provider: 'anthropic',
                    model: configuration.model,
                    session_id: await openProviderGatewaySession(ANTHROPIC_PROVIDER_ADAPTER, 'anthropic'),
                };
            } else {
                if (!configuration.baseUrl) {
                    throw new Error('OpenAI-compatible provider requires a base URL');
                }
                const parsedBaseUrl = new URL(configuration.baseUrl);
                const usesPrivilegedAdapter = parsedBaseUrl.protocol === 'https:';
                if (usesPrivilegedAdapter && parsedBaseUrl.pathname !== '/' && parsedBaseUrl.pathname !== '/v1') {
                    throw new Error('Remote OpenAI-compatible provider must use the compiled /v1 protocol path');
                }
                const adapter = usesPrivilegedAdapter
                    ? compileProviderAdapterInstallation({
                          adapterId: 'builtin.openai-compatible.chat-completions.v1',
                          providerId: configuration.provider,
                          modelId: configuration.model,
                          protocolFamily: 'openai-chat-completions',
                          origin: parsedBaseUrl.origin,
                      })
                    : null;
                if (adapter !== null && !isDesktopRuntime()) {
                    throw new Error('Hosted providers are available in desktop builds only');
                }
                runtime = {
                    provider: configuration.provider,
                    model: configuration.model,
                    base_url: configuration.baseUrl,
                    adapter,
                    session_id:
                        adapter === null ? null : await openProviderGatewaySession(adapter, configuration.provider),
                };
            }

            await cloudSession.replace_runtime(runtime);
            if (configuration.provider === 'anthropic') {
                logger.info('[Cloud AI] Anthropic provider configured');
            } else {
                logger.info(`[Cloud AI] ${configuration.provider} provider configured`);
            }
        }
);
