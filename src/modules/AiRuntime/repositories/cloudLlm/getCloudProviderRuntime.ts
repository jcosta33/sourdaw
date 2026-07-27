import { cloudSession, type CloudProviderRuntime } from './cloudSession';

export function getCloudProviderRuntime(): CloudProviderRuntime | null {
    return cloudSession.get_runtime();
}
