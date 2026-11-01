# Standing probes: audio, timing and format laws

Defects where tempo projection, musical law, a fresh instance, the highest admitted rate or an encoded format
disagrees with an independent reference. Split out of `correctness.md`; a stance matching this class carries this file
instead of it.
Each probe names the failure mode, the input, state or mutation to run, and the check that must go red.
Report the concrete break or none.

## Standing probes

1. **Tempo projection in both directions.** Trace seconds to beats and beats to seconds from captured
   tempo state to every terminal binding (AudioParam, segment writer, curve writer; track, clip, absent
   lanes) on a flat tempo and a ramp from a nonzero anchor, with an independent integral. Trace the real
   render origin through history expansion before prescribing a crop anchor (#5323); a private
   step-only inverse or lost anchor must fail the terminal-output case (#5209/#5243): include both
   moving-layer schedulers and stem branches, quantisation, slew and the compensated write clock, and a
   layer whose beat-zero value differs from its requested-start value under a tempo ramp.
2. **Musical law against DAW convention.** State the law an established DAW applies and evaluate at
   two grids (1/16 and 1/4); quantize the output again and require it unchanged; a result no reference
   DAW reproduces is a finding unless a decision record names the difference (#4788). Mapped ruler
   paint must follow the model's physical bar origins, not an inverse over bar names (Insert 2 at 4 in
   4/4 carries the origin to 6 and moves the clip at 8 to 10; two partial pieces can share a number);
   cover partial bars, denominators other than 4 and a later meter change.
3. **Fresh instance, highest rate, whole signal.** Render a fresh instance without setting the
   parameter under test and compare with explicit values (default routing); measure the actual engine
   at the highest admitted context rate for late tail and silence after the physical duration; compare
   mid and side impulses with an independent ideal delay. Trace enable transitions on sustained
   input: short-window output and gain against an already-open reference (zero crossing, near-threshold
   detector), enable-time hold seeding, and a single NaN or infinity compared sample for sample with a
   healthy reference through attack, hold, release and reopening; an output scrub proves nothing about
   recursive state. Revert only the default, cap or fence and the named PCM case must fail; follow the
   source through regenerated served WASM when the claim is about the shipped carrier.
4. **Format conformance by an independent decoder.** Compare real encoded output through the shipped
   decoder against the originating PCM at each bit depth, including container checksums and decoder
   warnings (FLAC Rice polarity per RFC 9639); reverting the grammar fix must fail the parity case.
