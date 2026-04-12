import { type OfflineDeviceNode } from '../types';
import { createCompressor } from './createCompressor';

// ── Sidechain compressor fallback ────────────────────────────────────────

export function createSidechainCompressorFallback(ctx: BaseAudioContext): OfflineDeviceNode {
    const dn = createCompressor(ctx);
    // Sidechain fallback omits the knee setting (reset to default 30).
    const [comp] = dn.nodes as [DynamicsCompressorNode];
    comp.knee.value = 30;
    return dn;
}