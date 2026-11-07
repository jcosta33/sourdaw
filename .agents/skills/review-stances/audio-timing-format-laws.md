# Standing probes: audio, MIDI, timing and format laws

Defects where tempo projection, the frame a parameter change lands on, the instant a scheduled source starts or
stops, musical or MIDI event law, a fresh instance, the highest admitted rate or an encoded format disagrees with
an independent reference. Split out of `correctness.md`; a stance matching this class carries this file instead
of it. Audio source offsets and every source reader belong to `audio-source-time.md`. Each probe names the
failure mode, the input, state or mutation to run, and the check that must go red. Report the concrete break or
none.

## Recording MIDI source positions include the admitted media lead-in

#5891 introduced recordingMidiSourceBeatAt with the clip's timeline start as its source origin. A punched clip
already carried midiOffsetBeats for latency lead-in, so a 30ms capture at 120 BPM stored a held end at 1.03 while
playback required 1.09, ending 0.06 beat before its sounded out. Zero-offset fixtures missed the source-basis
distinction. Historical private review prompts and tiers are unestablished.

Drive a real punch with 30ms latency and inspect its actual media offset. The compensated downbeat remains
representable at source 0: subtract startBeat−midiOffsetBeats before the existing nonnegative clamp. Use that
same owner conversion for onset, expression, release and Stop, with captured pass origins across loop edits.
Require the stored source end to map back to the sounded exclusive out, a late key-up to remain bounded and
one Undo/Redo group to restore the same rows. Keep zero-offset and ordinary manual/non-punch controls.
Removing only the media-origin adjustment must fail the real lead-in endpoint and downbeat cases; adding
the offset after clamping must fail the compensated downbeat. These are input/source laws, not a general
gesture-clock redesign or physical MIDI proof. Strike another valid note only0.01 beat before automatic out,
release once before out and once after it, and repeat with real media lead-in. The ordinary minimum duration may
never extend an automatic-owned source end; manual/no-cap minimum behavior remains a control. Invalid/nonpositive
available intervals must emit no zero or malformed note, through both key-up and held sealing. Automatic owner lifetime is in `session-lifecycle.md`.

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
   suspended context resumes on carries it through shared memory its processor reads at the head of every
   quantum, never through its port: Chromium dispatches each port message as its own task on the rendering
   thread with no promise that it runs before that quantum. #5988 posted the Transient Shaper's reset and
   gains over the port, and CI caught a resume whose first sample kept the old gain. Probe it by holding
   every port message to the processor until the resumed quantum is captured.
7. **A resume-frame gate must be an edge, not a write at `currentTime` (#5914).** An exclusive audition closed the
   programme with a gain gate written at raw `currentTime` while suspended; on a resume frame above its integer frame
   the gate closed one sample late and about one run in five read a nonzero programme sample on the first resumed
   frame. Its browser case asserted the gate's event time equal to `currentTime` (pinning the defect) and its unit
   fixtures applied every gain write at once. A disconnect or connect is a control message the rendering loop runs
   before the next quantum, so it holds from that quantum's first frame, suspended or running. Render from such a
   frame through a fixture applying Chromium's step rule (a time clamped up to `currentTime`, taking effect on the
   first frame at or after it) and assert the first sample.
8. **MIDI note correlation crosses the rack boundary.** When a transform stores a Note On decision for a
   later Note Off, drive supplied `noteInstanceId` values through `MidiRack`: one equal-pitch note, change the
   deciding parameter while held, then attack and release a second identity first. Assert emitted identity
   and pitch or suppression; channel/pitch FIFO must fail. Keep identityless FIFO apart.
9. **Expression ordering around note release (#805).** Hold the note-on's async worker, admit pressure,
   CC74, bend, release and the next same-channel note; read the curve points and execution order; an idle
   unrelated channel stays immediate.
10. **A boundary known in advance must not wait for the look-ahead window.** A main-thread stall longer than
    the look-ahead lets anything a window has not yet reached fall due unscheduled and join late, mid-buffer.
    Comp parts of one clip were keyed and gated separately, so the take after a comp boundary was scheduled
    only when a window reached it and a stall after Play dropped its head (introduced by the unreviewed direct
    commit `4f410257b2`). Schedule one window that reaches only the part before the boundary, jump the clock past
    the boundary, run the next window, and assert the next part's `start(when, offset)` received its exact
    boundary instant and region entry, not a late `now` with an elapsed offset.
11. **A live edit must cut sources it supersedes, including ones not yet sounding.** An edit during playback
    reaches the scheduler only as its next resolution; dedup keys that change with the edit, or omit what the
    edit changed (a take swapped over the same region), leave the emitted source sounding under or instead of
    the new one (same commit). Schedule, edit (comp, take swap, mute, and a part scheduled ahead), run the next
    pass, and assert `stop` on every superseded source before its start and exactly one `start` for the new
    content; an unchanged pass must call neither.
