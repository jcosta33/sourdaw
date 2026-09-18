import("stdfaust.lib");
// Stereo (#3730): the mono dry/wet blend — including its freeverb — is
// duplicated per channel, so a stereo insert keeps independent L/R instead of
// being downmixed to (L+R)/2 by the explicit-speakers mono worklet input. The
// two copies share one control surface: same-path UI items merge into a
// single zone, so every slider drives both channels and the
// addresses/automation are unchanged.
mono(x) = x * (1.0 - mix) + re.mono_freeverb(fb1, fb2, damp, spread)(x) * mix
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

process = par(i, 2, mono);
