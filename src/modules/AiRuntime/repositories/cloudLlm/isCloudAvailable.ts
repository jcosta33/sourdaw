import { cloudSession } from './cloudSession';

export function isCloudAvailable(): boolean {
    return cloudSession.is_available();
}
