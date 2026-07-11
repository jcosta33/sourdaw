import { clearCloudApiKey } from '../../repositories/cloudLlm/clearCloudApiKey';

/**
 * Remove the cloud API key and disable the cloud backend.
 */
export function removeCloudApi(): void {
    clearCloudApiKey();
}
