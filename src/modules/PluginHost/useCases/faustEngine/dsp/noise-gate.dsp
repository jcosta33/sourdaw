import("stdfaust.lib");

// Init values match the device catalog's declared defaults. `addDevice` seeds
// every declared parameter from the descriptor and pushes it at create, so the
// descriptor's default is the value that actually runs; an `hslider` init that
// disagreed described a state the device is never in.
thresh = hslider("threshold", -40, -90, 0, 0.1);
attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
hold = hslider("hold", 0.01, 0, 0.5, 0.001);
release = hslider("release", 0.1, 0.01, 1, 0.001);

peak(l, r) = max(abs(l), abs(r)) : si.smooth(ba.tau2pole(0.005));

// Linked stereo noise gate. This toolchain's compressors.lib has no
// co.gate_stereo, so the gate is built from a SUSTAINING ASR follower —
// en.ar is a one-shot envelope whose release retriggers at the peak and
// would close the gate under a sustained signal (review #563).
// Open flag, peak-held for `hold` seconds: the counter re-arms while the
// peak is above threshold and counts down afterwards.
open_held(p) = ba.if(counter > 0, 1.0, 0.0)
with {
    raw = ba.if(p > ba.db2linear(thresh), 1.0, 0.0);
    hold_samples = float(int(hold * ma.SR));
    tick(x) = ba.if(raw > 0.5, hold_samples, max(0.0, x - 1.0));
    counter = tick ~ _;
};

gate_gain(l, r) = open_held(peak(l, r)) : en.asr(attack, 1.0, release);
process(l, r) = l * gate_gain(l, r), r * gate_gain(l, r);
