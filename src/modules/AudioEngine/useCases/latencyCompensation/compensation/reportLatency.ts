import { externalLatencyRegistry } from './helpers';

export function reportLatency(deviceType: string, latencyMs: number): void {
    externalLatencyRegistry.set(deviceType, latencyMs);
}