import type { RuntimeGraphDeltaNode } from '../models/RuntimeGraphDelta';

/**
 * Canonical, bounded topology identity. Callers must supply the already sorted
 * parameter IDs and ordered device chain that the compiled-delta protocol owns.
 */
export function createRuntimeGraphTopologyFingerprint(node: RuntimeGraphDeltaNode): string {
    return JSON.stringify([
        node.id,
        node.kind,
        node.devices.map((device) => [device.id, device.type, device.externalInstanceId ?? null, device.parameterIds]),
    ]);
}
