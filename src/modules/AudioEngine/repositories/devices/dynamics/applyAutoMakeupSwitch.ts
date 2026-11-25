import { isCompressorAutoMakeupEngaged } from '#/utils/dynamicsCompressorMakeupLaw';

import { COMPRESSOR_AUTO_MAKEUP_TWIN_NODE } from '../../../models/DeviceParamLaws';
import { type OfflineDeviceNode } from '../types';

import { type AutoMakeupCanceller, compressorAutoMakeupCancellers } from './compressorAutoMakeupCancellers';

/**
 * Probe level fed to the twin. Blink's detector reads any peak at or below
 * 0.0001 as no attenuation at all (`abs_input <= 0.0001f ? 1 : …`), whatever
 * the threshold, so the twin never compresses its probe: its output is the
 * probe times Chromium's hidden post-gain, nothing else.
 */
const PROBE_LEVEL = 2 ** -14;
/**
 * The largest hidden gain the reciprocal covers. The compressor's descriptor
 * ranges reach about 51 (+34.2 dB, threshold −60 dB, knee 0, ratio 20), the
 * limiter's about 7.2 (+17.1 dB, threshold −30 dB); beyond this the
 * cancellation holds at 1/128 instead of following.
 */
const MAX_HIDDEN_GAIN = 128;
/**
 * Odd, so the shaper has a sample at zero. Linear interpolation of 1/x at this
 * spacing errs by under 4e-6 relative across the covered range.
 */
const RECIPROCAL_CURVE_POINTS = 32_769;

let reciprocalCurve: Float32Array<ArrayBuffer> | null = null;

/**
 * Maps the scaled twin output `s = hidden / MAX_HIDDEN_GAIN` to `1 / hidden`.
 * At or below `1 / MAX_HIDDEN_GAIN` (the twin's first pre-delay frames, before
 * its probe arrives) it holds unity, which joins the reciprocal continuously.
 */
function getReciprocalCurve(): Float32Array<ArrayBuffer> {
    if (reciprocalCurve) {
        return reciprocalCurve;
    }
    const curve = new Float32Array(RECIPROCAL_CURVE_POINTS);
    const floor = 1 / MAX_HIDDEN_GAIN;
    for (let index = 0; index < RECIPROCAL_CURVE_POINTS; index++) {
        const scaled = (2 * index) / (RECIPROCAL_CURVE_POINTS - 1) - 1;
        curve[index] = scaled > floor ? floor / scaled : 1;
    }
    reciprocalCurve = curve;
    return curve;
}

/**
 * The two nodes a device whose first stage is a `DynamicsCompressorNode`
 * hands the Auto Makeup switch: that node, and the trim gain right after it.
 */
export type AutoMakeupNodes = { compressor: DynamicsCompressorNode; trim: GainNode };

/**
 * The twin runs the device's own static-curve, attack and release values, so
 * it derives the same hidden post-gain on the same render quantum. Attack and
 * release keep its envelope's start-up identical to the main node's, so a
 * signal below threshold leaves unchanged from the first frame. The limiter's
 * fixed ratio 20, knee 0 and attack are copied the same way as the
 * compressor's knobs.
 */
function mirrorStaticCurve(compressor: DynamicsCompressorNode, twin: DynamicsCompressorNode): void {
    twin.threshold.value = compressor.threshold.value;
    twin.knee.value = compressor.knee.value;
    twin.ratio.value = compressor.ratio.value;
    twin.attack.value = compressor.attack.value;
    twin.release.value = compressor.release.value;
}

/**
 * Probe → twin compressor → scale → reciprocal shaper → the trim's gain. The
 * twin measures the hidden gain Chromium applies inside the main node, and the
 * shaper turns it into the gain that divides it back out. Measuring instead of
 * computing it keeps the cancellation on the node's own render quanta through
 * automation of threshold, knee and ratio together.
 */
function createCanceller(dn: OfflineDeviceNode, compressor: DynamicsCompressorNode): AutoMakeupCanceller {
    const context = compressor.context;
    const probe = context.createConstantSource();
    probe.offset.value = PROBE_LEVEL;
    const twin = context.createDynamicsCompressor();
    const scale = context.createGain();
    scale.gain.value = 1 / (PROBE_LEVEL * MAX_HIDDEN_GAIN);
    const reciprocal = context.createWaveShaper();
    reciprocal.curve = getReciprocalCurve();
    probe.connect(twin);
    twin.connect(scale);
    scale.connect(reciprocal);
    probe.start();
    dn.namedNodes = { ...dn.namedNodes, [COMPRESSOR_AUTO_MAKEUP_TWIN_NODE]: twin };
    return { probe, twin, scale, reciprocal };
}

function engage(trim: GainNode, canceller: AutoMakeupCanceller | undefined): void {
    canceller?.reciprocal.disconnect();
    trim.gain.value = 1;
}

function cancel(trim: GainNode, canceller: AutoMakeupCanceller): void {
    canceller.reciprocal.disconnect();
    trim.gain.value = 0;
    canceller.reciprocal.connect(trim.gain);
}

/**
 * Sets the switch. On leaves the trim at unity, so the node's own makeup
 * reaches the output exactly as it did before the switch existed; off drives
 * the trim with the twin's reciprocal.
 */
function setAutoMakeup(dn: OfflineDeviceNode, { compressor, trim }: AutoMakeupNodes, engaged: boolean): void {
    const existing = compressorAutoMakeupCancellers.get(trim);
    if (engaged) {
        engage(trim, existing);
        return;
    }
    const canceller = existing ?? createCanceller(dn, compressor);
    compressorAutoMakeupCancellers.set(trim, canceller);
    cancel(trim, canceller);
}

/**
 * The Auto Makeup switch of any built-in device whose first stage is a
 * `DynamicsCompressorNode` followed by a trim gain (the compressor and the
 * limiter). Call it after the device's own law has written the node. An
 * undefined `switchValue` (a write that does not carry the switch) leaves the
 * switch as it is, and a fresh node starts engaged, so a caller that never
 * names the switch (an adjustment layer, a stored device from before it
 * existed) renders the node's own makeup as it always has. Either way the twin,
 * when there is one, takes the node's current values.
 */
export function applyAutoMakeupSwitch(
    dn: OfflineDeviceNode,
    nodes: AutoMakeupNodes,
    switchValue: number | undefined
): void {
    if (switchValue !== undefined) {
        setAutoMakeup(dn, nodes, isCompressorAutoMakeupEngaged(switchValue));
    }
    const canceller = compressorAutoMakeupCancellers.get(nodes.trim);
    if (canceller) {
        mirrorStaticCurve(nodes.compressor, canceller.twin);
    }
}
