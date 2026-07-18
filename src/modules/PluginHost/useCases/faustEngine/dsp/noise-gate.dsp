import("stdfaust.lib");
process = co.gate_stereo(thresh, attack, hold, release)
with {
    thresh = hslider("threshold", -60, -90, 0, 0.1);
    attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
    hold = hslider("hold", 0.01, 0, 0.5, 0.001);
    release = hslider("release", 0.1, 0.01, 1, 0.001);
};