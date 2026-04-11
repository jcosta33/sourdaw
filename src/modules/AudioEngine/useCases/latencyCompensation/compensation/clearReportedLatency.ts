import { externalLatencyRegistry } from './helpers';

export function clearReportedLatency(deviceType: string): void {
    externalLatencyRegistry.delete(deviceType);
}