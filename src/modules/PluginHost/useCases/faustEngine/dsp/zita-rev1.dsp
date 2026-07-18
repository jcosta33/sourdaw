import("stdfaust.lib");
process = re.zita_rev1_stereo(rdel, f1, f2, t60dc, t60m, ma.SR)
with { 
    rdel = 60; 
    f1 = 200; 
    f2 = hslider("damping", 6000, 200, 12000, 100); 
    t60dc = hslider("decay_time", 3, 0.1, 15, 0.1); 
    t60m = 2; 
};
