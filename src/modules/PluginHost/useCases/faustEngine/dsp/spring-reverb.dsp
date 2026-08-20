import("stdfaust.lib");
process(x) = x * (1.0 - mix) + re.mono_freeverb(fb1, fb2, damp, spread)(x) * mix
with {
    decay = vgroup("spring", hslider("decay", 2, 0.1, 8, 0.1));
    damp = vgroup("spring", hslider("brightness", 0.5, 0, 1, 0.01));
    // 0.3 is the device catalog's declared default, which `addDevice` seeds and
    // pushes at create, so it is the value this device actually runs at.
    mix = vgroup("spring", hslider("mix", 0.3, 0, 1, 0.01));
    // freeverb feedback derived from the decay-time knob (longer decay -> more feedback)
    fb1 = max(0.0, min(0.98, 1.0 - 0.3 / decay));
    fb2 = fb1;
    spread = 0;
};
