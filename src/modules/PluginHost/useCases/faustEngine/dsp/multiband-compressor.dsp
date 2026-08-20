import("stdfaust.lib");

// Three-band compressor. This file used to be `process = dm.compressor_demo;`
// — a single-band stock demo with no `hslider` at all — while builtinDSP.ts
// declared three thresholds and two crossovers and the device UI exposed all
// five. Every one of those knobs failed to resolve against the compiled node
// and was swallowed by faustDeviceFactory's `logger.warn` (#2300).
//
// The split is Linkwitz-Riley 4th order (two cascaded 2nd-order Butterworth
// sections per leg). LR4 low + high at one frequency sums to an allpass with
// both legs in phase, so the bands recombine flat. A three-band tree does NOT
// sum flat on its own: the low band never passes through the upper crossover
// and so misses its phase shift. Feeding the low band through the upper
// crossover's own allpass (its LP + HP summed) restores it, and the whole
// bank then sums to AP(low) * AP(high) — unity magnitude at rest, which a
// naive LP/HP/HP split would not be.
low_threshold = hslider("low_threshold", -20, -60, 0, 0.5);
mid_threshold = hslider("mid_threshold", -15, -60, 0, 0.5);
high_threshold = hslider("high_threshold", -10, -60, 0, 0.5);
crossover_low = hslider("crossover_low", 200, 50, 500, 10);
crossover_high = hslider("crossover_high", 3000, 1000, 10000, 100);

lr4_lowpass(fc) = fi.lowpass(2, fc) : fi.lowpass(2, fc);
lr4_highpass(fc) = fi.highpass(2, fc) : fi.highpass(2, fc);
lr4_allpass(fc) = _ <: lr4_lowpass(fc) + lr4_highpass(fc);

low_split = lr4_lowpass(crossover_low) : lr4_allpass(crossover_high);
mid_split = lr4_highpass(crossover_low) : lr4_lowpass(crossover_high);
high_split = lr4_highpass(crossover_low) : lr4_highpass(crossover_high);

// Ratio and timing are fixed per band rather than exposed: only the five
// controls above are declared, and multiband units conventionally run faster
// attack/release the higher the band so low-end gain movement stays free of
// the ripple a fast release would put on it.
band_ratio = 3;
band(split, threshold, attack, release) =
    par(i, 2, split) : co.compressor_stereo(band_ratio, threshold, attack, release);

process = _, _ <:
    band(low_split, low_threshold, 0.02, 0.25),
    band(mid_split, mid_threshold, 0.008, 0.12),
    band(high_split, high_threshold, 0.003, 0.06)
    :> _, _;
