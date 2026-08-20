import("stdfaust.lib");

// Look-ahead brick-wall limiter. This file used to be
// `process = co.limiter_1176_R4_stereo;` — fixed ceiling, fixed release, no
// look-ahead and no `hslider` — while builtinDSP.ts declared ceiling, release
// and lookahead (#2300). `co.limiter_lad_*` is not a drop-in replacement: its
// look-ahead delay sizes a sliding-minimum window and has to be a compile-time
// constant, so the control would still not move anything.
//
// Ceiling in dB (-12..0): 0 dBFS has to be reachable, and the useful working
// range on a master is a few dB of gain reduction, which is what shipping
// limiters (FabFilter Pro-L, Ozone Maximizer) put on the same knob.
// Release in ms (1..1000, default 100): a brick-wall limiter needs a release
// well under 10 ms to stay clean on transients, and up to a second for
// programme-level gain riding.
// Look-ahead in ms (0..10, default 5): the conventional range; the delay line
// is sized for the maximum so the control stays live.
ceiling = hslider("ceiling", -0.3, -12, 0, 0.1);
release = hslider("release", 100, 1, 1000, 1);
lookahead = hslider("lookahead", 5, 0, 10, 0.1);

MAX_LOOKAHEAD_S = 0.01;
// Headroom over the maximum look-ahead for fdelay's interpolation.
max_delay_samples = ma.SR * (MAX_LOOKAHEAD_S + 0.001);

ceiling_linear = ba.db2linear(ceiling);
release_s = release * 0.001;
lookahead_s = lookahead * 0.001;

// Peak detector: instantaneous rise, decaying over the release. It is the only
// place the release time is applied, so the control means one thing.
//
// A single attack/release follower on the input cannot do this job and shape
// the gain as well. It only integrates upward while the sample exceeds it, so
// a waveform that crosses zero twice a cycle interrupts its own rise: on a
// 1 kHz full-scale transient the envelope was still 2.8 dB short of the true
// peak a whole look-ahead later, and the clip below was cutting all 2.8 dB off
// every transient rather than catching a rounding error.
peak_hold(fall) = loop ~ _
with {
    fall_pole = ba.tau2pole(max(fall, 1e-6));
    loop(previous, level) = max(level, previous * fall_pole);
};

// Gain ballistics. Both directions are set by the look-ahead, because that is
// the window the gain is allowed to move within.
//
// Down: a sixteenth of it, so the gain is settled well before the peak that
// called for it arrives. The divisor is a measured trade, not a round number:
// on a full-scale 1 kHz transient at a -6 dB ceiling and a 10 ms look-ahead,
// 8 leaves 0.016 dB of overshoot for the clip to remove, 16 leaves 0.009 dB
// and 32 leaves 0.006 dB — while a larger divisor also finishes the gain
// change earlier and earlier inside the window, which is the gain modulation
// the look-ahead exists to spread out. 16 keeps the ramp across half the
// window and the clip down to a tenth of a percent of the peak.
//
// Up: the look-ahead itself. Recovery is the detector's release, but the gain
// must not chase the detector's sag between one waveform peak and the next —
// letting it do that crept the gain back up and met the following peak too
// high, worth 0.006 dB on its own. The look-ahead is far shorter than any
// release above 10 ms, so it shapes the ripple without slowing recovery.
GAIN_FALL_TIME_CONSTANTS = 16;
gain_ballistics(fall, rise) = loop ~ _
with {
    fall_pole = ba.tau2pole(max(fall, 1e-6));
    rise_pole = ba.tau2pole(max(rise, 1e-6));
    loop(previous, target) =
        target + (previous - target) * select2(target < previous, rise_pole, fall_pole);
};

process(left, right) = limited(left), limited(right)
with {
    peak = max(abs(left), abs(right)) : peak_hold(release_s);
    target = min(1.0, ceiling_linear / max(peak, 1e-9));
    gain = target : gain_ballistics(lookahead_s / GAIN_FALL_TIME_CONSTANTS, lookahead_s);
    delayed(x) = de.fdelay(max_delay_samples, lookahead_s * ma.SR, x);
    // Safety net, not the mechanism: 0.009 dB of overshoot reaches it on a
    // full-scale transient, about a tenth of a percent of the peak, and a spec
    // pins that by rendering this DSP with the clip lifted and comparing. Hard
    // clipping is broadband distortion, which is the thing a user puts this
    // device on a master to avoid.
    limited(x) = max(0 - ceiling_linear, min(ceiling_linear, delayed(x) * gain));
};
