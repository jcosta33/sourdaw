import { type OfflineDeviceNode } from '../types';

import { type AutoMakeupNodes, applyAutoMakeupSwitch } from './applyAutoMakeupSwitch';
import { applyCompressorParams } from './applyCompressorParams';

/** `builtin-compressor`'s Auto Makeup switch. */
const COMPRESSOR_AUTO_MAKEUP_PARAM_ID = 'comp-auto-makeup';

/** `createCompressor` always names the trim; a node without it is not a built-in compressor. */
function resolveCompressorNodes(dn: OfflineDeviceNode): AutoMakeupNodes {
    const [compressor] = dn.nodes as [DynamicsCompressorNode];
    const trim = dn.namedNodes?.autoMakeupTrim;
    if (trim === undefined) {
        throw new Error('builtin-compressor node is missing its Auto Makeup trim');
    }
    return { compressor, trim: trim as GainNode };
}

/**
 * `builtin-compressor`'s applier: the shared compressor law, then the Auto
 * Makeup switch (`applyAutoMakeupSwitch`), which a write that does not carry
 * it leaves as it is.
 */
export function applyBuiltinCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    applyCompressorParams(dn, params);
    applyAutoMakeupSwitch(dn, resolveCompressorNodes(dn), params[COMPRESSOR_AUTO_MAKEUP_PARAM_ID]);
}
