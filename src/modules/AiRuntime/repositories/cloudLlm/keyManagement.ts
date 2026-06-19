import Anthropic from '@anthropic-ai/sdk';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

// SECURITY: this is a local-first DAW. The user supplies their own
// Anthropic API key which is why we pass `dangerouslyAllowBrowser: true`.
// The key never leaves the user's machine except in HTTPS requests to
// api.anthropic.com. Do NOT persist the key in a way that survives page
// reloads without explicit user consent, and never log the key itself.
//
// The key + client live in a closure-scoped holder so importers cannot
// reassign `apiKey` / `client` directly from outside this module.
const cloudAuth: { apiKey: string | null; client: Anthropic | null } = {
    apiKey: null,
    client: null,
};

// Controllers for in-flight cloud stream requests. Each active stream registers
// its AbortController here and unregisters when it settles. Clearing the key
// aborts them all so a revoked key cannot keep being used until the stream
// closes on its own (a security gap — see clearCloudApiKey).
const activeStreamControllers = new Set<AbortController>();

/** Register a controller for an in-flight cloud stream. Returns the controller. */
export function registerCloudStreamController(controller: AbortController): AbortController {
    activeStreamControllers.add(controller);
    return controller;
}

/** Unregister a controller once its stream has settled. */
export function unregisterCloudStreamController(controller: AbortController): void {
    activeStreamControllers.delete(controller);
}

export const setCloudApiKey = inject({ logger })(
    ({ logger }) =>
        function setCloudApiKey(key: string): void {
            cloudAuth.apiKey = key;
            cloudAuth.client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
            logger.info('[Cloud AI] API key set');
        }
);

export function isCloudAvailable(): boolean {
    return cloudAuth.apiKey !== null && cloudAuth.client !== null;
}

export function clearCloudApiKey(): void {
    cloudAuth.apiKey = null;
    cloudAuth.client = null;

    // Abort any in-flight streams so a revoked key stops being used immediately
    // rather than continuing until each SSE stream closes on its own. Abort a
    // snapshot — each stream's own cleanup removes itself from the live set.
    for (const controller of [...activeStreamControllers]) {
        controller.abort();
    }
    activeStreamControllers.clear();
}

export function getCloudClient(): Anthropic | null {
    return cloudAuth.client;
}
