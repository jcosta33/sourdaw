import("stdfaust.lib");
freq = hslider("freq", 440, 20, 6000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
d1 = hslider("drawbar_16", 8, 0, 8, 1);
d2 = hslider("drawbar_8", 8, 0, 8, 1);
d3 = hslider("drawbar_513", 0, 0, 8, 1);
d4 = hslider("drawbar_4", 0, 0, 8, 1);
d5 = hslider("drawbar_223", 0, 0, 8, 1);
d6 = hslider("drawbar_2", 0, 0, 8, 1);
d7 = hslider("drawbar_135", 0, 0, 8, 1);
d8 = hslider("drawbar_113", 0, 0, 8, 1);
d9 = hslider("drawbar_1", 0, 0, 8, 1);
perc_level = hslider("percussion", 0.3, 0, 1, 0.01);
perc_harm = hslider("perc_harmonic", 2, 2, 3, 1);
leslie_speed = hslider("leslie_speed", 6.0, 0.1, 12.0, 0.1);
leslie_depth = hslider("leslie_depth", 0.25, 0.0, 0.8, 0.01);
click_level = hslider("click", 0.3, 0, 1, 0.01);
// Tonewheels with leakage (~-40dB adjacent crosstalk)
leak = 0.01;
tw(f, d) = os.osc(f) * d + os.osc(f * 1.0007) * d * leak;
organ = tw(freq*0.5, d1) + tw(freq, d2) + tw(freq*1.5, d3) +
        tw(freq*2, d4) + tw(freq*3, d5) + tw(freq*4, d6) +
        tw(freq*5, d7) + tw(freq*6, d8) + tw(freq*8, d9);
tonewheel = organ / 72.0;
// Key click: filtered noise burst
click = no.noise : fi.resonbp(3000, 2, 1) * en.ar(0.001, 0.004, gate) * click_level;
// Percussion: 2nd or 3rd harmonic fast decay, single-trigger
perc = os.osc(freq * perc_harm) * en.ar(0.001, 0.15, gate) * perc_level;
// Leslie: L/R phase offset for stereo rotation
leslie_l = (tonewheel + click + perc) * (1.0 + leslie_depth * os.osc(leslie_speed));
leslie_r = (tonewheel + click + perc) * (1.0 + leslie_depth * os.osc(leslie_speed + 1.5708));
env = en.adsr(0.005, 0.0, 1.0, 0.03, gate);
process = leslie_l * env * gain, leslie_r * env * gain;