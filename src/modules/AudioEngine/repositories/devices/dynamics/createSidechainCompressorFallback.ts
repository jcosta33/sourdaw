import { SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS } from '../../../models/BuiltinDeviceRuntime';
import { type OfflineDeviceNode } from '../types';

import { createCompressor } from './createCompressor';
import { preparedOfflineSidechainCompressors } from './prepareOfflineSidechainCompressor';

// ── Sidechain compressor fallback ────────────────────────────────────────

export function createSidechainCompressorFallback(ctx: BaseAudioContext, device?: object): OfflineDeviceNode {
    const prepared = preparedOfflineSidechainCompressors.get(ctx);
    if (device && prepared?.targets.has(device)) {
        if (typeof AudioWorkletNode !== 'undefined') {
            try {
                const workletNode = new AudioWorkletNode(
                    ctx,
                    'sidechain-compressor-processor',
                    SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS
                );
                return {
                    inputNode: workletNode,
                    outputNode: workletNode,
                    nodes: [workletNode],
                };
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                prepared.onWarning?.(
                    `Sidechain processor unavailable; using the offline compressor fallback. ${reason}`
                );
            }
        } else {
            prepared.onWarning?.(
                'Sidechain processor unavailable; using the offline compressor fallback. AudioWorkletNode is unavailable.'
            );
        }
    }

    const dn = createCompressor(ctx);
    // Sidechain fallback omits the knee setting (reset to default 30).
    const [comp] = dn.nodes as [DynamicsCompressorNode];
    comp.knee.value = 30;
    return dn;
}
