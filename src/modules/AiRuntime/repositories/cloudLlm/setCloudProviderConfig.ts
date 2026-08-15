import Anthropic from '@anthropic-ai/sdk';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type HostedLlmConfiguration } from '../../models/HostedLlmProvider';
import { compileProviderAdapterInstallation } from '../providerAdapterRegistry';

import { cloudSession, type CloudProviderRuntime } from './cloudSession';

export const setCloudProviderConfig = inject({ logger })(
    ({ logger }) =>
        function setCloudProviderConfig(configuration: HostedLlmConfiguration): void {
            let runtime: CloudProviderRuntime;
            if (configuration.provider === 'anthropic') {
                runtime = {
                    provider: 'anthropic',
                    api_key: configuration.apiKey,
                    model: configuration.model,
                    client: new Anthropic({
                        apiKey: configuration.apiKey,
                        dangerouslyAllowBrowser: true,
                    }),
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
                runtime = {
                    provider: configuration.provider,
                    api_key: configuration.apiKey,
                    model: configuration.model,
                    base_url: configuration.baseUrl,
                    ...(usesPrivilegedAdapter
                        ? {
                              adapter: compileProviderAdapterInstallation({
                                  adapterId: 'builtin.openai-compatible.chat-completions.v1',
                                  providerId: configuration.provider,
                                  modelId: configuration.model,
                                  protocolFamily: 'openai-chat-completions',
                                  origin: parsedBaseUrl.origin,
                              }),
                          }
                        : {}),
                };
            }

            cloudSession.replace_runtime(runtime);
            if (configuration.provider === 'anthropic') {
                logger.info('[Cloud AI] API key set');
            } else {
                logger.info(`[Cloud AI] ${configuration.provider} provider configured`);
            }
        }
);
