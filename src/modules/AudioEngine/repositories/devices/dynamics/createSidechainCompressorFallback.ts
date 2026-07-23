import { type OfflineDeviceNode } from '../types';

import { createCompressor } from './createCompressor';
import { preparedOfflineSidechainCompressorContexts } from './prepareOfflineSidechainCompressor';

// ── Sidechain compressor fallback ────────────────────────────────────────

export function createSidechainCompressorFallback(ctx: BaseAudioContext): OfflineDeviceNode {
    if (preparedOfflineSidechainCompressorContexts.has(ctx)) {
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
    }

    const dn = createCompressor(ctx);
    // Sidechain fallback omits the knee setting (reset to default 30).
    const [comp] = dn.nodes as [DynamicsCompressorNode];
    comp.knee.value = 30;
    return dn;
}
