import { bridges } from './helpers';

export function resetIntegratedMeters(deviceId: string): void {
    bridges.get(deviceId)?.resetIntegrated();
}