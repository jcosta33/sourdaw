/**
 * The nodes that cancel Chromium's hidden makeup gain for one built-in
 * compressor or limiter whose Auto Makeup switch is off: probe → twin compressor → scale
 * → reciprocal shaper, which drives the device's trim gain.
 */
export type AutoMakeupCanceller = {
    probe: ConstantSourceNode;
    twin: DynamicsCompressorNode;
    scale: GainNode;
    reciprocal: WaveShaperNode;
};

/** Each canceller, keyed by the trim gain it drives. */
export const compressorAutoMakeupCancellers = new WeakMap<GainNode, AutoMakeupCanceller>();
