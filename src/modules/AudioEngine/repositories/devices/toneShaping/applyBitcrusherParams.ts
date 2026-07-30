import { type OfflineDeviceNode } from '../types';

import { makeBitcrusherCurve } from './makeBitcrusherCurve';

/** Mirrors the `crush-rate` bounds declared in BuiltinEffectDescriptors. */
const MIN_RATE = 1;
const MAX_RATE = 40;

/**
 * The rate-reduction node's `rate` param, if this device managed to build one.
 *
 * `createBitcrusher` appends the decimator after the fixed five, so index 5 is
 * where it lands. Probing for `parameters` rather than testing
 * `instanceof AudioWorkletNode` keeps this working where the constructor is not
 * the page's own — an offline render context, a test double — and returns
 * `undefined` for the shaper-only fallback graph.
 */
function rateDecimatorParam(dn: OfflineDeviceNode): AudioParam | undefined {
    const candidate: unknown = dn.nodes[5];
    if (typeof candidate !== 'object' || candidate === null || !('parameters' in candidate)) {
        return undefined;
    }
    const { parameters } = candidate as { parameters: AudioParamMap };
    return parameters.get('rate');
}

export function applyBitcrusherParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryBC = dn.nodes[1] as GainNode;
    const wetBC = dn.nodes[2] as GainNode;
    const shaperBC = dn.nodes[3] as WaveShaperNode;
    if (params['crush-bits'] !== undefined) {
        shaperBC.curve = makeBitcrusherCurve(Math.max(1, Math.round(params['crush-bits'])));
    }
    if (params['crush-rate'] !== undefined) {
        // Held to the declared range here as well as at the store's write door:
        // that clamp fails open for a device the store cannot resolve (one
        // mid-attach, an offline render strip, a test double), and the divisor
        // must not drop below 1 — under 1 asks for interpolation, not decimation.
        const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, params['crush-rate']));
        const rateParam = rateDecimatorParam(dn);
        if (rateParam) {
            rateParam.value = rate;
        }
    }
    if (params['crush-mix'] !== undefined) {
        wetBC.gain.value = params['crush-mix'];
        dryBC.gain.value = 1 - params['crush-mix'];
    }
}
