import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type HostedLlmProviderInfo } from '../../models/HostedLlmProvider';
import { hostedLlmProviderStatusStore } from '../../stores/hostedLlmProviderStatusStore';
import { closeProviderGatewaySession } from '../closeProviderGatewaySession';
import { type CompiledProviderAdapter } from '../providerAdapterRegistry';

export type AnthropicCloudRuntime = Readonly<{
    provider: 'anthropic';
    model: string;
    session_id: string;
}>;

export type OpenAiCompatibleCloudRuntime = Readonly<{
    provider: 'openai' | 'openai-compatible';
    model: string;
    base_url: string;
    adapter?: CompiledProviderAdapter | null;
    session_id: string | null;
}>;

export type CloudProviderRuntime = AnthropicCloudRuntime | OpenAiCompatibleCloudRuntime;

/**
 * Owns opaque provider sessions and active request controllers as one volatile runtime.
 */
class CloudSession {
    #runtime: CloudProviderRuntime | null = null;
    #active_stream_controllers = new Set<AbortController>();
    #owned_session_ids = new Set<string>();
    #is_revoking = false;
    #transition_revision = 0;

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

    async clear(): Promise<void> {
        this.#transition_revision += 1;
        const previous = this.#runtime;
        this.#runtime = null;
        hostedLlmProviderStatusStore.set(null);
        if (this.#is_revoking) {
            return;
        }
        this.#revoke_active_streams(new AiRuntimeConfigurationChangedError());
        this.#track_runtime_session(previous);
        await this.#close_owned_sessions();
    }

    async replace_runtime(runtime: CloudProviderRuntime): Promise<void> {
        if (this.#is_revoking) {
            throw new Error('Cloud credential replacement cannot run during session revocation');
        }
        const transition_revision = ++this.#transition_revision;
        const previous = this.#runtime;
        this.#track_runtime_session(previous);
        this.#track_runtime_session(runtime);
        this.#runtime = null;
        hostedLlmProviderStatusStore.set(null);
        this.#revoke_active_streams(new AiRuntimeConfigurationChangedError());
        try {
            await this.#close_owned_sessions(runtime.session_id);
        } catch (error) {
            await this.#close_runtime_session(runtime).catch(() => undefined);
            throw error;
        }
        if (transition_revision !== this.#transition_revision) {
            await this.#close_runtime_session(runtime);
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

    #track_runtime_session(runtime: CloudProviderRuntime | null): void {
        const sessionId = runtime?.session_id ?? null;
        if (sessionId !== null) {
            this.#owned_session_ids.add(sessionId);
        }
    }

    async #close_runtime_session(runtime: CloudProviderRuntime | null): Promise<void> {
        const sessionId = runtime?.session_id ?? null;
        if (sessionId === null) {
            return;
        }
        await closeProviderGatewaySession(sessionId);
        this.#owned_session_ids.delete(sessionId);
    }

    async #close_owned_sessions(excludedSessionId: string | null = null): Promise<void> {
        let firstError: unknown = null;
        for (const sessionId of [...this.#owned_session_ids]) {
            if (sessionId === excludedSessionId) {
                continue;
            }
            try {
                await closeProviderGatewaySession(sessionId);
                this.#owned_session_ids.delete(sessionId);
            } catch (error) {
                firstError ??= error;
            }
        }
        if (firstError !== null) {
            if (firstError instanceof Error) {
                throw firstError;
            }
            throw new Error('Cloud credential session revocation failed', { cause: firstError });
        }
    }
}

export const cloudSession = Object.freeze(new CloudSession());
