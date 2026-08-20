import("stdfaust.lib");

// F1 — insert-style delay needs its own dry/wet blend, and there is no
// separate dry bus mixing one back in upstream of this node.
//
// Hand-rolled feedback delay line rather than `ef.echo`: verified against a
// real Faust compile (node script over `@grame/faustwasm`, not just reading
// the source) that `ef.echo` passes its input through undelayed at the same
// sample it is written into the delay line, on top of the delayed feedback
// repeats — i.e. it is not the "100% wet" processor a `dry_wet` control
// expects to crossfade against. `(+ : de.fdelay(...)) ~ *(feedback)` alone
// (no dry-mixed `+` outside the loop) confirmed clean under the same
// harness: pure silence until the first delayed repeat, so `dry_wet` at 0
// is exactly the input and at 1 is exactly the repeats, matching the
// insert-effect convention every other device here already follows.
mix = hslider("dry_wet", 0.3, 0, 1, 0.01);

maxdel = 2.0;
delay = hslider("delay", 0.3, 0.01, 2, 0.01);
feedback = hslider("feedback", 0.5, 0, 0.95, 0.01);

// `/tape_delay/tone` was declared in builtinDSP.ts with no `hslider` behind it
// (#2300). It sits inside the feedback loop, not after it, so each successive
// repeat is darker than the last — the tape head-and-electronics roll-off a
// tone control on this device is expected to model.
tone = hslider("tone", 4000, 500, 12000, 100);
wet = (+ : fi.lowpass(1, tone) : de.fdelay(ma.SR * maxdel, delay * ma.SR)) ~ *(feedback);

process = _ <: *(1 - mix), (wet : *(mix)) :> _;
