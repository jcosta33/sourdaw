import("stdfaust.lib");
freq  = hslider("freq", 440, 20, 12000, 0.01);
gate  = button("gate");
det   = hslider("detune", 15, 0, 100, 0.1);
mix   = hslider("center_mix", 0.7, 0, 1, 0.01);
// 7 voices: center + 3 pairs spread above/below in cents
spread(n) = pow(2, n * det / 1200);
v0 =  os.sawtooth(freq)             * mix;
v1 =  os.sawtooth(freq * spread(1)) * (1-mix) * 0.5;
v2 =  os.sawtooth(freq / spread(1)) * (1-mix) * 0.5;
v3 =  os.sawtooth(freq * spread(2)) * (1-mix) * 0.4;
v4 =  os.sawtooth(freq / spread(2)) * (1-mix) * 0.4;
v5 =  os.sawtooth(freq * spread(3)) * (1-mix) * 0.3;
v6 =  os.sawtooth(freq / spread(3)) * (1-mix) * 0.3;
raw = (v0 + v1 + v2 + v3 + v4 + v5 + v6) / 3.4;

lfo_rate = hslider("lfo_rate", 5, 0.1, 20, 0.1);
lfo_depth = hslider("lfo_depth", 0, 0, 1, 0.01);
lfo = os.osc(lfo_rate) * lfo_depth;

cutoff = hslider("cutoff", 6000, 100, 20000, 1);
mod_cutoff = cutoff * (1 + lfo * 0.5) : max(100) : min(20000) : si.smoo;

resonance = hslider("resonance", 0.3, 0, 0.99, 0.01);
filtered = fi.resonlp(mod_cutoff, 1 + resonance * 8, raw);
process = filtered * en.adsr(
    hslider("attack",  0.01,  0.001, 5, 0.001),
    hslider("decay",   0.3,   0.01,  5, 0.01),
    hslider("sustain", 0.8,   0,     1, 0.01),
    hslider("release", 0.5,   0.01, 10, 0.01),
    gate
) <: _, _;
