/**
 * Use case: Cloud AI API key management.
 *
 * Provides a public API for the UI to configure, check, and clear
 * cloud API keys for Claude / OpenAI. Keys are stored in memory
 * and optionally persisted via the preferences store.
 */

import { setCloudApiKey, clearCloudApiKey } from '../repositories/cloudLlmRepository';

// Re-export for UI consumers
export { isCloudAvailable } from '../repositories/cloudLlmRepository';

/**
 * Configure the cloud AI backend with an API key.
 * Call from the settings UI when the user enters their key.
 */
export function configureCloudApi(apiKey: string): void {
    if (!apiKey.trim()) {
        throw new Error('API key cannot be empty');
    }
    setCloudApiKey(apiKey.trim());
}

/**
 * Remove the cloud API key and disable the cloud backend.
 */
export function removeCloudApi(): void {
    clearCloudApiKey();
}
