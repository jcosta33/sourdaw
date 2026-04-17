import("stdfaust.lib");
freq = hslider("freq", 440, 20, 12000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
morph = hslider("morph", 0, 0, 1, 0.001) : si.smoo;
atk = hslider("attack", 0.01, 0.001, 5, 0.001);
dec = hslider("decay", 0.3, 0.01, 5, 0.01);
sus = hslider("sustain", 0.6, 0, 1, 0.01);
rel = hslider("release", 0.5, 0.01, 10, 0.01);
// 4 waveforms: sine → triangle → saw → square
w1 = os.osc(freq);
w2 = os.triangle(freq);
w3 = os.sawtooth(freq);
w4 = os.square(freq);
// Segment crossfade: morph 0..0.33 = w1↔w2, 0.33..0.66 = w2↔w3, 0.66..1 = w3↔w4
seg = morph * 3;
s1 = min(1, max(0, 1 - seg));
s2 = min(1, max(0, min(seg, 2 - seg)));
s3 = min(1, max(0, min(seg - 1, 3 - seg)));
s4 = min(1, max(0, seg - 2));
wave = w1 * s1 + w2 * s2 + w3 * s3 + w4 * s4;
env = en.adsr(atk, dec, sus, rel, gate);
process = wave * env * gain <: _, _;