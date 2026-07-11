import type Anthropic from '@anthropic-ai/sdk';

type CloudCredentials = Readonly<{
    api_key: string;
    client: Anthropic;
}>;

/**
 * Owns the complete volatile cloud session invariant. This is not a helper
 * collection: credentials and stream controllers are private runtime state,
 * and every transition that can couple them is enforced here.
 */
class CloudSession {
    #credentials: CloudCredentials | null = null;
    #active_stream_controllers = new Set<AbortController>();
    #is_revoking = false;
    #transition_revision = 0;

    get_client(): Anthropic | null {
        if (this.#is_revoking) {
            return null;
        }
        return this.#credentials?.client ?? null;
    }

    is_available(): boolean {
        return !this.#is_revoking && this.#credentials !== null;
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
        this.#credentials = null;
        if (this.#is_revoking) {
            return;
        }
        this.#revoke_active_streams();
    }

    replace_credentials({ api_key, client }: { api_key: string; client: Anthropic }): void {
        if (this.#is_revoking) {
            throw new Error('Cloud credential replacement cannot run during session revocation');
        }
        const transition_revision = ++this.#transition_revision;
        this.#revoke_active_streams();
        if (transition_revision !== this.#transition_revision) {
            throw new Error('Cloud credential replacement was superseded');
        }
        this.#credentials = { api_key, client };
    }

    #revoke_active_streams(): void {
        this.#is_revoking = true;
        try {
            for (const controller of [...this.#active_stream_controllers]) {
                controller.abort();
            }
        } finally {
            this.#active_stream_controllers.clear();
            this.#is_revoking = false;
        }
    }
}

export const cloudSession = Object.freeze(new CloudSession());
