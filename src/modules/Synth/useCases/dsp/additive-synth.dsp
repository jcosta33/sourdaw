import("stdfaust.lib");
freq = hslider("freq", 440, 20, 12000, 0.01);
gain = hslider("gain", 1, 0, 1, 0.01);
gate = button("gate");
partials = 16;

// Anti-aliased partial weighting with smooth transition before Nyquist
nyquist_weight(f) = w
with {
    f_lo = ma.SR * 0.45;
    f_hi = ma.SR * 0.49;
    s = max(0.0, min(1.0, (f_hi - f) / (f_hi - f_lo)));
    w = s * s * (3.0 - 2.0 * s);
};

// Sum of harmonics with rolloff and anti-aliasing
process = sum(i, partials,
    os.osc(freq * (i+1)) / pow(i+1, rolloff) * nyquist_weight(freq * (i+1))
) / partials * en.adsr(0.01, 0.2, 0.7, 0.5, gate) * gain <: _, _
with { rolloff = hslider("rolloff", 1.5, 0.5, 4, 0.01); };
