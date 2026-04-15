import("stdfaust.lib");
freq = hslider("freq", 440, 20, 12000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
damping = hslider("damping", 0.5, 0, 1, 0.01);
excitation = hslider("excitation", 0.8, 0, 1, 0.01);
body = hslider("body", 0.5, 0, 1, 0.01);
// Excitation burst: filtered noise
burst_len = 0.003;
burst = no.noise * excitation * en.ar(0.0001, burst_len, gate);
// Karplus-Strong: delay line with damped feedback
delay_samples = ma.SR / freq;
damp_coeff = 0.99 - damping * 0.15;
ks_loop = + ~ (de.fdelay(4096, delay_samples - 1) : fi.lowpass(1, freq * (2 + body * 8)) : *(damp_coeff));
process = burst : ks_loop * gain <: _, _;