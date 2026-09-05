import("stdfaust.lib");
width = hslider("width", 100, 0, 200, 1) / 100.0;
mono_freq = hslider("mono_bass", 0, 0, 500, 1);
mid(l, r) = (l + r) * 0.5;
side(l, r) = (l - r) * 0.5;
// M/S stereo widener with highpass crossover on side signal for mono bass.
// When mono_freq > 0, the side channel is highpass filtered at mono_freq,
// collapsing bass below mono_freq to mono while preserving higher-frequency stereo width.
// When mono_freq == 0, the side signal passes through unmodified (exact identity at width 100).
process(l, r) = m + s * width, m - s * width
with {
    m = mid(l, r);
    s_raw = side(l, r);
    s = ba.if(mono_freq > 0, s_raw : fi.highpass(1, max(1.0, mono_freq)), s_raw);
};
