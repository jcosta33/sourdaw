import { externalLatencyRegistry } from './externalLatencyRegistry';

export function clearReportedLatency(deviceId: string): void {
    externalLatencyRegistry.delete(deviceId);
}
