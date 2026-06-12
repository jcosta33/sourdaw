import { externalLatencyRegistry } from './externalLatencyRegistry';

export function reportLatency(deviceId: string, latencyMs: number): void {
    externalLatencyRegistry.set(deviceId, latencyMs);
}
