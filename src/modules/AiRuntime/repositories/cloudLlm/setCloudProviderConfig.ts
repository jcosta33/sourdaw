import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopBridge';

import { type HostedLlmConfiguration } from '../../models/HostedLlmProvider';
import { closeProviderGatewaySession } from '../closeProviderGatewaySession';
import { ensureAdapterCapabilities } from '../ensureAdapterCapabilities';
import { openProviderGatewaySession } from '../openProviderGatewaySession';
import { probeProviderGatewaySession } from '../probeProviderGatewaySession';
import {
    compileProviderAdapterInstallation,
    type CompiledProviderAdapter,
    OPENAI_CHAT_COMPLETIONS_ADAPTER_ID,
    OPENAI_RESPONSES_ADAPTER_ID,
} from '../providerAdapterRegistry';

import { cloudSession, type CloudProviderRuntime } from './cloudSession';
import { inFlightCloudConnect } from './inFlightCloudConnect';

const ANTHROPIC_PROVIDER_ADAPTER = Object.freeze({
    adapterId: 'builtin.anthropic.messages.v1' as const,
    origin: 'https://api.anthropic.com' as const,
});
const CONNECT_PROBE_DEADLINE_MS = 15_000;

async function waitForProbe(probe: Promise<void>, signal: AbortSignal): Promise<void> {
    let rejectOnAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
        rejectOnAbort = () => reject(signal.reason);
        signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    try {
        await Promise.race([probe, aborted]);
    } catch (error) {
        void probe.then(
            () => undefined,
            () => undefined
        );
        throw error;
    } finally {
        if (rejectOnAbort !== null) {
            signal.removeEventListener('abort', rejectOnAbort);
        }
    }
}

async function verifyOpenedProviderSession(runtime: CloudProviderRuntime, connectSignal: AbortSignal): Promise<void> {
    const sessionId = runtime.session_id;
    if (sessionId === null) {
        return;
    }
    const probeSignal = AbortSignal.any([connectSignal, AbortSignal.timeout(CONNECT_PROBE_DEADLINE_MS)]);
    try {
        let probe: Promise<void>;
        if (runtime.provider !== 'anthropic' && runtime.adapter) {
            probe = ensureAdapterCapabilities(runtime.adapter, sessionId, probeSignal);
        } else {
            probe = probeProviderGatewaySession(sessionId, probeSignal).then(() => undefined);
        }
        await waitForProbe(probe, probeSignal);
    } catch (error) {
        await closeProviderGatewaySession(sessionId).catch(() => undefined);
        if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new Error('Provider adapter capability probe timed out', { cause: error });
        }
        throw error;
    }
}

/**
 * First-party OpenAI speaks the Responses protocol; every other OpenAI-compatible
 * endpoint speaks chat completions. A plain HTTP base URL compiles no adapter and
 * stays on the renderer development path.
 */
function compileHostedOpenAiAdapter(
    configuration: HostedLlmConfiguration,
    parsedBaseUrl: URL
): CompiledProviderAdapter | null {
    if (parsedBaseUrl.protocol !== 'https:') {
        return null;
    }
    if (parsedBaseUrl.pathname !== '/' && parsedBaseUrl.pathname !== '/v1') {
        throw new Error('Remote OpenAI-compatible provider must use the compiled /v1 protocol path');
    }
    const contract =
        configuration.provider === 'openai'
            ? { adapterId: OPENAI_RESPONSES_ADAPTER_ID, protocolFamily: 'openai-responses' as const }
            : { adapterId: OPENAI_CHAT_COMPLETIONS_ADAPTER_ID, protocolFamily: 'openai-chat-completions' as const };
    return compileProviderAdapterInstallation({
        ...contract,
        providerId: configuration.provider,
        modelId: configuration.model,
        origin: parsedBaseUrl.origin,
    });
}

async function discardSupersededCandidate(runtime: CloudProviderRuntime): Promise<never> {
    const sessionId = runtime.session_id;
    if (sessionId !== null) {
        await closeProviderGatewaySession(sessionId);
    }
    throw new Error(inFlightCloudConnect.supersededMessage);
}

export const setCloudProviderConfig = inject({ logger })(
    ({ logger }) =>
        async function setCloudProviderConfig(configuration: HostedLlmConfiguration): Promise<void> {
            const { generation, abort: connectAbort } = inFlightCloudConnect.begin();
            try {
                let runtime: CloudProviderRuntime;
                if (configuration.provider === 'anthropic') {
                    if (configuration.authentication !== 'api-key') {
                        throw new Error('Anthropic requires API-key authentication');
                    }
                    if (!isDesktopRuntime()) {
                        throw new Error('Hosted providers are available in desktop builds only');
                    }
                    runtime = {
                        provider: 'anthropic',
                        model: configuration.model,
                        authentication: configuration.authentication,
                        session_id: await openProviderGatewaySession(
                            ANTHROPIC_PROVIDER_ADAPTER,
                            'anthropic',
                            configuration.apiKey
                        ),
                    };
                } else {
                    if (configuration.provider === 'openai' && configuration.authentication !== 'api-key') {
                        throw new Error('OpenAI requires API-key authentication');
                    }
                    if (!configuration.baseUrl) {
                        throw new Error('OpenAI-compatible provider requires a base URL');
                    }
                    const baseUrl = configuration.baseUrl;
                    const adapter = compileHostedOpenAiAdapter(configuration, new URL(baseUrl));
                    if (adapter === null) {
                        if (configuration.provider === 'openai') {
                            throw new Error('First-party OpenAI requires its compiled HTTPS origin');
                        }
                        if (configuration.authentication !== 'none' || configuration.apiKey !== '') {
                            throw new Error('Authenticated OpenAI-compatible providers require HTTPS');
                        }
                        runtime = {
                            provider: 'openai-compatible',
                            model: configuration.model,
                            base_url: baseUrl,
                            authentication: configuration.authentication,
                            adapter: null,
                            session_id: null,
                        };
                    } else {
                        if (!isDesktopRuntime()) {
                            throw new Error('Hosted providers are available in desktop builds only');
                        }
                        const sessionId = await openProviderGatewaySession(
                            adapter,
                            configuration.provider,
                            configuration.apiKey
                        );
                        runtime =
                            configuration.provider === 'openai'
                                ? {
                                      provider: 'openai',
                                      model: configuration.model,
                                      base_url: baseUrl,
                                      authentication: configuration.authentication,
                                      adapter,
                                      session_id: sessionId,
                                  }
                                : {
                                      provider: 'openai-compatible',
                                      model: configuration.model,
                                      base_url: baseUrl,
                                      authentication: configuration.authentication,
                                      adapter,
                                      session_id: sessionId,
                                  };
                    }
                }

                await verifyOpenedProviderSession(runtime, connectAbort.signal);
                if (!inFlightCloudConnect.isCurrent(generation)) {
                    await discardSupersededCandidate(runtime);
                }
                await cloudSession.replace_runtime(runtime);
                if (configuration.provider === 'anthropic') {
                    logger.info('[Cloud AI] Anthropic provider configured');
                } else {
                    logger.info(`[Cloud AI] ${configuration.provider} provider configured`);
                }
            } finally {
                inFlightCloudConnect.release(connectAbort);
            }
        }
);
