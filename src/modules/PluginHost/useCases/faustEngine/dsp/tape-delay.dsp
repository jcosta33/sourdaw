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
wet = (+ : de.fdelay(ma.SR * maxdel, delay * ma.SR)) ~ *(feedback);

process = _ <: *(1 - mix), (wet : *(mix)) :> _;
