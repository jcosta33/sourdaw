# Standing probes: audio, MIDI, timing and format laws

Defects where tempo projection, the frame a parameter change lands on, musical or MIDI event law, a fresh
instance, the highest admitted rate or an encoded format disagrees with an independent reference. Split out of
`correctness.md`; a stance matching this class carries this file instead of it. Audio source offsets and every
source reader belong to `audio-source-time.md`. Each probe names the failure mode, the input, state or mutation
to run, and the check that must go red. Report the concrete break or none.

## Standing probes

1. **Tempo projection in both directions to every terminal binding.** Trace seconds to beats and beats to
   seconds from captured tempo state to every terminal binding (AudioParam, segment writer, curve writer;
   track, clip, absent lanes) on a flat tempo and a ramp from a nonzero anchor, with an independent integral.
   Trace the real render origin through history expansion before prescribing a crop anchor (#5323); a private
   step-only inverse or lost anchor must fail the terminal-output case (#5209/#5243): include both
   moving-layer schedulers and stem branches, quantisation, slew and the compensated write clock, and a
   layer whose beat-zero value differs from its requested-start value under a tempo ramp. Source offsets
   converted at the clip-start tempo are `audio-source-time.md` probe 1.
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
5. **A future AudioParam write lands on its encoded frame, not the raw quotient.** `currentTime` is a frame
   count divided by the sample rate and can sit a hair above its integer frame; Chromium applies an event whose
   time exceeds a frame on the next sample. Drive a fake context whose `currentTime` is `n / sampleRate` with
   `n * sampleRate` evaluating above `n` (896 / 48000 does) and require every scheduled future time to land on
   frame `n` after `Math.ceil(time * sampleRate)`. Asserting the raw `currentTime` value pins the defect
   instead of observing it (#5867). A fake context cannot show Chromium's clamp; immediate writes need probe 6.
6. **An immediate or already reached write cannot reach its frame through an AudioParam (#5867).** Chromium
   clamps any event time below `currentTime` up to `currentTime`, so on such a frame an a-rate value lands one
   sample late and a k-rate value a whole quantum late. #5867 first scheduled immediate Transient Shaper
   gains at raw `currentTime` (its unit case asserted that value while the browser case re-entering from
   bypass in a suspended context read the pre-change gain on its first sample), then encoded them one step
   below the quotient, which Chromium clamped back. Run real Chromium: suspend, resume and suspend again until
   the suspended frame sits above its integer frame, make the write, resume and capture the first rendered
   quantum; or suspend an `OfflineAudioContext` at every quantum and write through the AudioParam alone to
   see where the clamp moves the event. A device whose re-entry or immediate change must hold on the frame a
   suspended context resumes on carries it through its port.
7. **A resume-frame gate must be an edge, not a write at `currentTime` (#5914).** An exclusive audition
   closed the programme with a gain gate written at raw `currentTime` while suspended; on a resume frame above
   its integer frame the gate closed one sample late and about one run in five read a nonzero programme
   sample on the first resumed frame. Its browser case asserted the gate's event time equal to
   `currentTime` (pinning the defect) and its unit fixtures applied every gain write at once. A disconnect
   or connect is a control message the rendering loop runs before the next quantum, so it holds from that
   quantum's first frame. Render from such a frame through a fixture applying Chromium's step rule (a time
   clamped up to `currentTime`, taking effect on the first frame at or after it) and assert the first sample.
8. **MIDI note correlation crosses the rack boundary.** When a transform stores a Note On decision for a
   later Note Off, drive supplied `noteInstanceId` values through `MidiRack`: one equal-pitch note, change the
   deciding parameter while held, then attack and release a second identity first. Assert emitted identity
   and pitch or suppression; channel/pitch FIFO must fail. Keep identityless FIFO apart.
9. **Expression ordering around note release (#805).** Hold the note-on's async worker, admit pressure,
   CC74, bend, release and the next same-channel note; read the curve points and execution order; an idle
   unrelated channel stays immediate.
