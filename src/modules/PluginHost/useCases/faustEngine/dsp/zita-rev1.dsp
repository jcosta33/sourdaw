import("stdfaust.lib");

// F1 — insert-style reverb needs its own dry/wet blend; `zita_rev1_stereo` is
// 100% wet on its own, and there is no separate dry bus mixing this back in
// upstream of this node.
mix = hslider("dry_wet", 0.3, 0, 1, 0.01);

wet = re.zita_rev1_stereo(rdel, f1, f2, t60dc, t60m, ma.SR)
with {
    rdel = 60;
    f1 = 200;
    f2 = hslider("damping", 6000, 200, 12000, 100);
    t60dc = hslider("decay_time", 3, 0.1, 15, 0.1);
    t60m = 2;
};

process = _,_ <: (par(i, 2, *(1 - mix))), (wet : par(i, 2, *(mix))) :> _,_;
