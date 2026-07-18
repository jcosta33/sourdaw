import("stdfaust.lib");
freq = hslider("freq", 200, 50, 1000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");

lfo_rate = hslider("lfo_rate", 5, 0.1, 20, 0.1);
lfo_depth = hslider("lfo_depth", 0, 0, 1, 0.01);
lfo = os.osc(lfo_rate) * lfo_depth;

cutoff = hslider("cutoff", 0.3, 0.01, 1, 0.001);
mod_cutoff = cutoff * (1 + lfo * 0.5) : si.smoo;

resonance = hslider("resonance", 8, 0.7, 20, 0.1) : si.smoo;
envmod = hslider("envmod", 0.5, 0, 1, 0.01) : si.smoo;
decay = hslider("decay", 0.15, 0.01, 1.0, 0.01);
slide = hslider("slide", 0.06, 0.001, 0.5, 0.001);
dist = hslider("drive", 1.0, 1.0, 5.0, 0.1);

sfreq = freq : si.smooth(ba.tau2pole(slide));
mfreq = sfreq * (1 + lfo * 0.02); // slight pitch mod
osc_out = os.sawtooth(mfreq);

accent_env = en.ar(0.003, decay, gate) * envmod;
filtered = osc_out : ve.diodeLadder(min(1.0, mod_cutoff + accent_env), resonance);
saturated = ma.tanh(filtered * dist);
amp_env = en.adsr(0.003, 0.2, 0.0, 0.05, gate) * gain;
process = saturated * amp_env <: _, _;