import("stdfaust.lib");
process = co.compressor_stereo(ratio, thresh, attack, release)
with {
    ratio = hslider("ratio", 4, 1, 20, 0.1);
    thresh = hslider("threshold", -20, -60, 0, 0.1);
    attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
    release = hslider("release", 0.1, 0.01, 1, 0.001);
};
