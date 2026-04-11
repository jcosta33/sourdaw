import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { setCloudApiKey } from '../../repositories/cloudLlm/keyManagement';

/**
 * Configure the cloud AI backend with an API key.
 * Call from the settings UI when the user enters their key.
 */
export function configureCloudApi(apiKey: string): void {
    if (!apiKey.trim()) {
        throw createAiRuntimeError('API key cannot be empty');
    }
    setCloudApiKey(apiKey.trim());
}