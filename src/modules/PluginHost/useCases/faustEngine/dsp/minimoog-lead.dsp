import("stdfaust.lib");
freq = hslider("freq", 440, 20, 12000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
glide = hslider("glide", 0.08, 0.001, 0.5, 0.001);

lfo_rate = hslider("lfo_rate", 5, 0.1, 20, 0.1);
lfo_depth = hslider("lfo_depth", 0, 0, 1, 0.01);
lfo = os.osc(lfo_rate) * lfo_depth;

sfreq = freq : si.smooth(ba.tau2pole(glide));
mfreq = sfreq * (1 + lfo * 0.05);

detune = hslider("detune", 7, 0, 50, 0.1);
osc3lvl = hslider("osc3", 0.3, 0, 1, 0.01);

cutoff = hslider("cutoff", 1800, 80, 18000, 1);
mod_cutoff = cutoff * (1 + lfo * 0.5) : si.smoo;

res = hslider("resonance", 4, 0.707, 25, 0.1) : si.smoo;
env_amt = hslider("env_amount", 0.3, 0, 1, 0.01);
atk = hslider("attack", 0.005, 0.001, 5, 0.001);
dec = hslider("decay", 0.25, 0.01, 5, 0.01);
sus = hslider("sustain", 0.6, 0, 1, 0.01);
rel = hslider("release", 0.3, 0.01, 5, 0.01);
spread = detune * 0.01;
osc1 = os.sawtooth(mfreq);
osc2 = os.sawtooth(mfreq * (1 + spread));
osc3 = os.sawtooth(mfreq * (1 - spread * 1.5));
mixed = (osc1 + osc2 + osc3 * osc3lvl) / 3;
env = en.adsr(atk, dec, sus, rel, gate);
fenv = env * env_amt;
filtered = mixed : ve.moogLadder(min(1.0, mod_cutoff / 20000 + fenv), res);
process = filtered * env * gain * 0.8 <: _, _;