import("stdfaust.lib");
width = hslider("width", 100, 0, 200, 1) / 100.0;
mono_freq = hslider("mono_bass", 0, 0, 500, 1);
mid(l, r) = (l + r) * 0.5;
side(l, r) = (l - r) * 0.5;
// The original recombine applied + and - to single buses (arity error), and
// its bass-duck envelope was applied to nothing. Inline the M/S processing so
// each output sees both buses and the duck envelope tracks the side signal.
process(l, r) = m + s * width, m - s * width
with {
    m = mid(l, r);
    s_raw = side(l, r);
    duck = ba.if(mono_freq > 1, s_raw : fi.lowpass(1, mono_freq) : abs : si.smooth(0.999), 0.0);
    s = s_raw * (1.0 - duck);
};
