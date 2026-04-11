import { bridges } from './helpers';

export function unregisterProofDevice(deviceId: string): void {
    bridges.delete(deviceId);
}