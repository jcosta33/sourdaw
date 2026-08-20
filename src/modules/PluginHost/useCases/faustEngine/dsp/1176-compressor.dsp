import("stdfaust.lib");

// Stereo-linked compression detecting on the LOUDER channel rather than on the
// SUM of the two — the same correction `multiband-compressor.dsp` carries, and
// for the same reason. `co.compressor_stereo` in this toolchain's
// compressors.lib is
//   `cgm = compression_gain_mono(ratio,thresh,att,rel,abs(x)+abs(y))`,
// and that sum feeds a `ba.linear2db`, so centred material presents 2A where
// the same signal panned hard presents A: exactly +6.02 dB. The threshold knob
// is labelled dB and read as dBFS, and it was up to 6 dB out depending on how
// wide the source happened to be.
//
// `max(abs(x), abs(y))` is the linked-peak idiom `noise-gate.dsp` already
// uses. One gain, computed once, applied to both channels, so the stereo image
// survives exactly as `compressor_stereo` preserves it.
compress_stereo(ratio, thresh, att, rel, x, y) = gain * x, gain * y
with {
    gain = max(abs(x), abs(y)) : co.compression_gain_mono(ratio, thresh, att, rel);
};

process = compress_stereo(ratio, thresh, attack, release)
with {
    ratio = hslider("ratio", 4, 1, 20, 0.1);
    thresh = hslider("threshold", -20, -60, 0, 0.1);
    attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
    release = hslider("release", 0.1, 0.01, 1, 0.001);
};
