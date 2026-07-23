import { type OfflineDeviceNode } from '../types';

import { createCompressor } from './createCompressor';
import { preparedOfflineSidechainCompressorTargets } from './prepareOfflineSidechainCompressor';

// ── Sidechain compressor fallback ────────────────────────────────────────

export function createSidechainCompressorFallback(ctx: BaseAudioContext, deviceId?: string): OfflineDeviceNode {
    const preparedTargets = preparedOfflineSidechainCompressorTargets.get(ctx);
    if (deviceId && preparedTargets?.has(deviceId) && typeof AudioWorkletNode !== 'undefined') {
        try {
            const workletNode = new AudioWorkletNode(ctx, 'sidechain-compressor-processor', {
                numberOfInputs: 2,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
            return {
                inputNode: workletNode,
                outputNode: workletNode,
                nodes: [workletNode],
            };
        } catch {
            // Continue into the established single-input compressor fallback.
        }
    }

    const dn = createCompressor(ctx);
    // Sidechain fallback omits the knee setting (reset to default 30).
    const [comp] = dn.nodes as [DynamicsCompressorNode];
    comp.knee.value = 30;
    return dn;
}
