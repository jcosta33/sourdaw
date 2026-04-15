import("stdfaust.lib");
freq = hslider("freq", 440, 20, 12000, 0.01);
gate = button("gate");
partials = 16;
// Sum of harmonics with rolloff
process = sum(i, partials,
    os.osc(freq * (i+1)) / pow(i+1, rolloff)
) / partials * en.adsr(0.01, 0.2, 0.7, 0.5, gate) <: _, _
with { rolloff = hslider("rolloff", 1.5, 0.5, 4, 0.01); };