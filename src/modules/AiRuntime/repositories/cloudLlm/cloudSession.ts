import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type HostedLlmProviderInfo } from '../../models/HostedLlmProvider';
import { hostedLlmProviderStatusStore } from '../../stores/hostedLlmProviderStatusStore';
import { type CompiledProviderAdapter } from '../providerAdapterRegistry';

import type Anthropic from '@anthropic-ai/sdk';

export type AnthropicCloudRuntime = Readonly<{
    provider: 'anthropic';
    api_key: string;
    model: string;
    client: Anthropic;
}>;

export type OpenAiCompatibleCloudRuntime = Readonly<{
    provider: 'openai' | 'openai-compatible';
    api_key: string;
    model: string;
    base_url: string;
    adapter?: CompiledProviderAdapter | null;
}>;

export type CloudProviderRuntime = AnthropicCloudRuntime | OpenAiCompatibleCloudRuntime;

/**
 * Owns the complete volatile cloud session invariant. This is not a helper
 * collection: credentials and stream controllers are private runtime state,
 * and every transition that can couple them is enforced here.
 */
class CloudSession {
    #runtime: CloudProviderRuntime | null = null;
    #active_stream_controllers = new Set<AbortController>();
    #is_revoking = false;
    #transition_revision = 0;

    get_client(): Anthropic | null {
        if (this.#is_revoking) {
            return null;
        }
        if (this.#runtime?.provider !== 'anthropic') {
            return null;
        }
        return this.#runtime.client;
    }

    get_runtime(): CloudProviderRuntime | null {
        if (this.#is_revoking) {
            return null;
        }
        return this.#runtime;
    }

    is_available(): boolean {
        return !this.#is_revoking && this.#runtime !== null;
    }

    register_controller(controller: AbortController): AbortController {
        if (this.#is_revoking) {
            controller.abort();
            return controller;
        }
        this.#active_stream_controllers.add(controller);
        return controller;
    }

    unregister_controller(controller: AbortController): void {
        this.#active_stream_controllers.delete(controller);
    }

    clear(): void {
        this.#transition_revision += 1;
        this.#runtime = null;
        hostedLlmProviderStatusStore.set(null);
        if (this.#is_revoking) {
            return;
        }
        this.#revoke_active_streams(new AiRuntimeConfigurationChangedError());
    }

    replace_runtime(runtime: CloudProviderRuntime): void {
        if (this.#is_revoking) {
            throw new Error('Cloud credential replacement cannot run during session revocation');
        }
        const transition_revision = ++this.#transition_revision;
        this.#revoke_active_streams(new AiRuntimeConfigurationChangedError());
        if (transition_revision !== this.#transition_revision) {
            throw new Error('Cloud credential replacement was superseded');
        }
        this.#runtime = runtime;
        const providerInfo: HostedLlmProviderInfo = {
            provider: runtime.provider,
            model: runtime.model,
            baseUrl: runtime.provider === 'anthropic' ? null : runtime.base_url,
        };
        hostedLlmProviderStatusStore.set(providerInfo);
    }

    #revoke_active_streams(reason: AiRuntimeConfigurationChangedError): void {
        this.#is_revoking = true;
        try {
            for (const controller of [...this.#active_stream_controllers]) {
                controller.abort(reason);
            }
        } finally {
            this.#active_stream_controllers.clear();
            this.#is_revoking = false;
        }
    }
}

export const cloudSession = Object.freeze(new CloudSession());
