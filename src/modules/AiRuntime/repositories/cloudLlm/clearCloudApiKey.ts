import { cloudSession } from './cloudSession';

export function clearCloudApiKey(): void {
    cloudSession.clear();
}
