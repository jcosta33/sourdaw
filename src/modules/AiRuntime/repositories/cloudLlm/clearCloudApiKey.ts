import { activeCloudStreamControllers } from './activeCloudStreamControllers';
import { cloudAuthState } from './cloudAuthState';

export function clearCloudApiKey(): void {
    cloudAuthState.apiKey = null;
    cloudAuthState.client = null;

    // Abort a snapshot so each stream can still remove itself from the live
    // set in its own finally block before the holder is cleared.
    for (const controller of [...activeCloudStreamControllers]) {
        controller.abort();
    }
    activeCloudStreamControllers.clear();
}
