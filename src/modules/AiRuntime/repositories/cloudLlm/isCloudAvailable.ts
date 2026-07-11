import { cloudAuthState } from './cloudAuthState';

export function isCloudAvailable(): boolean {
    return cloudAuthState.apiKey !== null && cloudAuthState.client !== null;
}
