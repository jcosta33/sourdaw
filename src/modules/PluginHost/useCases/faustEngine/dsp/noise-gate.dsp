import("stdfaust.lib");

thresh = hslider("threshold", -60, -90, 0, 0.1);
attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
hold = hslider("hold", 0.01, 0, 0.5, 0.001);
release = hslider("release", 0.1, 0.01, 1, 0.001);

// Linked stereo noise gate. This toolchain's compressors.lib has no
// co.gate_stereo, so the gate is built from an AR envelope follower: the
// open target (1 above threshold, 0 below) is smoothed with the attack
// time opening and hold+release closing.
peak(l, r) = max(abs(l), abs(r)) : si.smooth(ba.tau2pole(0.005));
open_target(p) = ba.if(p > ba.db2linear(thresh), 1.0, 0.0);
gate_gain(l, r) = open_target(peak(l, r)) : en.ar(attack, hold + release);
process(l, r) = l * gate_gain(l, r), r * gate_gain(l, r);
