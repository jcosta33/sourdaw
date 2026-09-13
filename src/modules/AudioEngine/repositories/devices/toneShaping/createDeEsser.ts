import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineDeviceNode } from '../types';

// ── De-esser ─────────────────────────────────────────────────────────────

/** Band width shared by the detector bandpass and its cancellation tap. */
export const DEESSER_BAND_Q = 2;
/** Descriptor defaults for `deess-freq` and `deess-range`. */
export const DEFAULT_DEESSER_FREQUENCY_HZ = 6000;
export const DEFAULT_DEESSER_RANGE_DB = -12;

/**
 * Split-band de-esser (issue #3735). One bandpass feeds three taps:
 *
 *  - the compressor, whose detector therefore hears **only the selected
 *    band** — broadband audio cannot drive sibilant reduction;
 *  - a cancellation gain at `−w`, removing the raw band from the output;
 *  - a listen gain, which isolates the detector band for auditioning.
 *
 * The compressed band re-enters through the wet gain at `+w`, where
 * `w = 10^(range/20)`. With the compressor idle the two band taps cancel
 * exactly (same filter, mirrored weights) and the device is unity; with the
 * compressor fully engaged the raw band is gone and only `w` of it could
 * remain — so the band is attenuated by at most `−range` dB. Range is the
 * declared reduction **limit**, not a ratio.
 */
export function createDeEsser(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const inputGain = ctx.createGain();
    inputGain.gain.value = 1;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = DEFAULT_DEESSER_FREQUENCY_HZ;
    bandpass.Q.value = DEESSER_BAND_Q;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.05;
    comp.knee.value = 3;
    const defaultWeight = dbToGain(DEFAULT_DEESSER_RANGE_DB);
    const wet = ctx.createGain();
    wet.gain.value = defaultWeight;
    const cancel = ctx.createGain();
    cancel.gain.value = -defaultWeight;
    const listen = ctx.createGain();
    listen.gain.value = 0;
    const output = ctx.createGain();
    input.connect(inputGain);
    inputGain.connect(output);
    input.connect(bandpass);
    bandpass.connect(comp);
    comp.connect(wet);
    wet.connect(output);
    bandpass.connect(cancel);
    cancel.connect(output);
    bandpass.connect(listen);
    listen.connect(output);
    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, bandpass, comp, wet, cancel, listen, inputGain, output],
        namedNodes: { input, bandpass, comp, wet, cancel, listen, inputGain, output },
    };
}
