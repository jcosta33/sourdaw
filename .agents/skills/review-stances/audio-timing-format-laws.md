# Standing probes: audio, MIDI, timing and format laws

Defects where tempo projection, the frame a parameter change lands on, the instant a scheduled source starts or
stops, musical or MIDI event law, a fresh instance, the highest admitted rate or an encoded format disagrees with
an independent reference. Split out of `correctness.md`; a stance matching this class carries this file instead
of it. Audio source offsets and every source reader belong to `audio-source-time.md`. Each probe names the
failure mode, the input, state or mutation to run, and the check that must go red. Report the concrete break or
none.

## Standing probes

1. **Tempo projection in both directions to every terminal binding.** Trace seconds to beats and beats to
   seconds from captured tempo state to every terminal binding (AudioParam, segment writer, curve writer;
   track, clip, absent lanes) on a flat tempo and a ramp from a nonzero anchor, with an independent integral.
   Trace the real render origin through history expansion before prescribing a crop anchor (#5323); a private
   step-only inverse or lost anchor must fail the terminal-output case (#5209/#5243): include both
   moving-layer schedulers and stem branches, quantisation, slew and the compensated write clock, and a
   layer whose beat-zero value differs from its requested-start value under a tempo ramp. Source offsets
   converted at the clip-start tempo are `audio-source-time.md` probe 1. Re-date an admitted punch's SAME original out/occurrence
   after accepted120→60 adoption: browser uses the effective adoption instant; native compares old/new durations
   from the SAME epoch beat to original out, only at a newly authorized sounded epoch. Loop/locate geometry,
   cancelled/planned/future epochs cannot retarget it. Ignoring adoption must fail the connected out/producer case.
2. **Musical law against DAW convention.** State the law an established DAW applies and evaluate at
   two grids (1/16 and 1/4); quantize the output again and require it unchanged; a result no reference
   DAW reproduces is a finding unless a decision record names the difference (#4788). Mapped ruler
   paint must follow the model's physical bar origins, not an inverse over bar names (Insert 2 at 4 in
   4/4 carries the origin to 6 and moves the clip at 8 to 10; two partial pieces can share a number);
   cover partial bars, denominators other than 4 and a later meter change. Track clip-list bar endpoints
   must use the live default meter and time-signature map: beats 18–27 read 5–7 in 4/4, 7–10 in 3/4
   or 6/8, and 7–10 with a 5/8 change at beat 8 over a 4/4 default. Changing either meter source while
   the list is mounted must update its labels. Restore quarter-note arithmetic or remove the subscription;
   `TrackClipsSection.spec.tsx` must fail. Follow the view's `useMeterInput` to the public
   `getBarNumberAtBeat` query so the display shares the ruler's snapped meter law.
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
   A future source can also expose pre-event gain: at48kHz, drive the real clip emitter at
   `21.668000000000003` with nonzero PCM and an undrawn attack. Capture every onset sample for fresh gains
   and actual onended-to-pool reuse, including the prior unity-reset timeline; `22.42` and an unmodified
   native replay are controls. The main-base causal probe for#6277 reproduced a full-amplitude first sample
   removed only by changing acquisition seed, with all other captured samples equal. Fresh default gain
   was introduced by direct commit`4f410257b2`, pooled reset1 by`134120470a`; no associated PR was found.
   Later#6129 retained that sequence; its comp/source-call checks did not observe native onset gain.
   Seed the fade's effective intended value before source.start, including equal-time outgoing plateaus
   and nonzero drawn progress; preserve envelope/frozen unity. Reverting only the fresh or pooled seed
   must fail the named first-sample PCM comparison. A mocked source.start snapshot proves construction,
   not rendered audio; retain whole-interval native replay, exact frames and pooling history.
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

12. **Recorded MIDI shares its admitted media origin (#5891).** At120BPM with30ms latency, require the real
    compensated downbeat at source0 and held out1.09 rather than1.03: onset, expression, off and Stop subtract
    startBeat−midiOffsetBeats BEFORE clamping, preserving captured pass origins across loop edits. Removing the
    media-origin adjustment must fail the endpoint; adding it after clamping must fail the downbeat. Strike at
    11.02 for out11.03, release before out and hold after out, with zero and nonzero lead-in: the ordinary0.0625
    minimum cannot extend the automatic-owned source cap. Both key-up and sealing emit no zero/malformed note
    when no positive interval remains; ordinary manual/no-cap minimum stays a control. Historical private review
    prompts and tiers are unestablished. Owner lifetime: `session-lifecycle.md` probe12; no hardware MIDI claim.
13. **Recovered clocks do not prove rendered loop continuity (#6277).** The100ms tick-driven buffer window
    and stop/clear seam route appear in direct commit `4f410257b2`; no associated introducing PR is established.
    Later public#4897 seam checks and#6004 clock-gap/wrap checks do not establish pre-block successor admission
    or a rendered interval through a blocked main thread. Withhold200ms of ticks across a2s seam and multiple
    125ms seams, retaining a source ledger copied before the block and an independent source-time reference.
    `startPlayheadSchedulerLoopAudioStall.spec.ts` must fail if admission waits for the old100ms window or
    prepares only one successor. Require the actual completed coverage, recorded completion audio timestamp,
    250ms endpoint, one-frame-beyond retained-lead control and mapped recovery beyond coverage. Advance the
    context clock during preparation: tick-entry time cannot certify350ms remaining at completion. Bound
    work even under an unmoving monotonic clock and tiny legal loops; shortfall must name actual unadmitted
    coverage. Separately capture real Chromium programme PCM through the block and compare an unstalled
    reference for missing intervals, phase and duplicates, including existing fades. API calls, positive meters,
    recovered wrap counts and a+2s-anchor admission benchmark cannot replace that rendered-signal proof.
