# Standing probes: audio, MIDI, timing and format laws

Defects where tempo projection, the frame a parameter change lands on, the instant a scheduled source starts or
stops, musical or MIDI event law, a fresh instance, the highest admitted rate or an encoded format disagrees with
an independent reference. A stance matching this class carries this file instead of `correctness.md`. Audio
source offsets and every source reader belong to `audio-source-time.md`. Each probe names the failure mode, the
input, state or mutation to run, and the check that must go red. Report the concrete break or none.

## Standing probes

1. **Tempo projection in both directions to every terminal binding (#5209, #5243, #5323).** Trace seconds to
   beats and beats to seconds from captured tempo state to every terminal binding (AudioParam, segment writer,
   curve writer; track, clip, absent lanes) on a flat tempo and a ramp from a nonzero anchor, against an
   independent integral. Trace the real render origin through history expansion before prescribing a crop
   anchor; a private step-only inverse or a lost anchor must fail the terminal-output case. Include both
   moving-layer schedulers and stem branches, quantisation, slew and the compensated write clock, and a layer
   whose beat-zero value differs from its requested-start value under a tempo ramp. Source offsets converted at
   the clip-start tempo are `audio-source-time.md` probe 1. Re-date an admitted punch's same original out and
   occurrence after an accepted 120 to 60 BPM adoption: the browser uses the effective adoption instant; native
   compares old and new durations from the same epoch beat to the original out, only at a newly authorized
   sounded epoch. Loop or locate geometry and cancelled, planned or future epochs cannot retarget it. Ignoring
   adoption must fail the connected out/producer case.
2. **Musical law against DAW convention (#4788).** State the law an established DAW applies and evaluate at two
   grids (1/16 and 1/4); quantize the output again and require it unchanged; a result no reference DAW
   reproduces is a finding unless a decision record names the difference. Mapped ruler paint follows the
   model's physical bar origins, not an inverse over bar names (Insert 2 at 4 in 4/4 carries the origin to 6 and
   moves the clip at 8 to 10; two partial pieces can share a number); cover partial bars, denominators other
   than 4 and a later meter change. Track clip-list bar endpoints use the live default meter and time-signature
   map: beats 18–27 read 5–7 in 4/4, 7–10 in 3/4 or 6/8, and 7–10 with a 5/8 change at beat 8 over a 4/4
   default. Changing either meter source while the list is mounted updates its labels. Restoring quarter-note
   arithmetic or removing the subscription must fail `TrackClipsSection.spec.tsx`. Follow the view's
   `useMeterInput` to the public `getBarNumberAtBeat` query so the display shares the ruler's snapped meter law.
3. **Fresh instance, highest rate, whole signal.** Render a fresh instance without setting the parameter under
   test and compare with explicit values (default routing); render the actual engine at the highest admitted
   context rate for late tail and silence after the physical duration; compare mid and side impulses with an
   independent ideal delay. Trace enable transitions on sustained input: short-window output and gain against
   an already-open reference (zero crossing, near-threshold detector), enable-time hold seeding, and a single
   NaN or infinity compared sample for sample with a healthy reference through attack, hold, release and
   reopening; an output scrub proves nothing about recursive state. Reverting only the default, cap or fence
   must fail the named PCM case. When the claim is about the shipped carrier, read `wasm:verify` in the
   Types and contracts job on the head; the reviewer never regenerates WASM.
4. **Format conformance by an independent decoder.** Compare real encoded output through the shipped decoder
   against the originating PCM at each bit depth, including container checksums and decoder warnings (FLAC Rice
   polarity per RFC 9639); reverting the grammar fix must fail the parity case.
5. **A future AudioParam write lands on its encoded frame, not the raw quotient (#5867).** `currentTime` is a
   frame count divided by the sample rate and can sit a hair above its integer frame; Chromium applies an event
   whose time exceeds a frame on the next sample. Drive a fake context whose `currentTime` is `n / sampleRate`
   with `n * sampleRate` evaluating above `n` (896 / 48000 does) and require every scheduled future time to land
   on frame `n` after `Math.ceil(time * sampleRate)`. Asserting the raw `currentTime` value pins the defect
   instead of observing it. A fake context cannot show Chromium's clamp; immediate writes need probe 6.
6. **An immediate or already reached write cannot reach its frame through an AudioParam (#5867, #5988).**
   Runs: CI; the reviewer reads the Affected end-to-end job running `tests/e2e/transientShaperEffect.spec.ts`
   on the head. Chromium clamps any event time below `currentTime` up to `currentTime`, so on such a frame an
   a-rate value lands one sample late and a k-rate value a whole quantum late; encoding a write one step below
   the quotient is clamped back. A unit case asserting the raw `currentTime` while the browser case re-entering
   from bypass in a suspended context reads the pre-change gain on its first sample is the tell. In real
   Chromium, suspend, resume and suspend again until the suspended frame sits above its integer frame, make the
   write, resume and capture the first rendered quantum; or suspend an `OfflineAudioContext` at every quantum and
   write through the AudioParam alone to see where the clamp moves the event. A device whose re-entry or
   immediate change must hold on the frame a suspended context resumes on carries it through shared memory its
   processor reads at the head of every quantum, never through its port: Chromium dispatches each port message
   as its own task on the rendering thread with no promise that it runs before that quantum. From the fixed
   commit, check that such state does not travel over the port; the browser case holds every port message to
   the processor until the resumed quantum is captured.
7. **A resume-frame gate is an edge, not a write at `currentTime` (#5914, #6277).** A gain gate written at raw
   `currentTime` while suspended closes one sample late on a resume frame above its integer frame, so the first
   resumed frame can read a nonzero programme sample; a browser case asserting the gate's event time equal to
   `currentTime` pins the defect, and unit fixtures applying every gain write at once hide it. A disconnect or
   connect is a control message the rendering loop runs before the next quantum, so it holds from that quantum's
   first frame, suspended or running. Render from such a frame through a fixture applying Chromium's step rule
   (a time clamped up to `currentTime`, taking effect on the first frame at or after it) and assert the first
   sample. A future source can also expose pre-event gain: at 48 kHz, drive the real clip emitter at
   `21.668000000000003` with nonzero PCM and an undrawn attack. Capture every onset sample for fresh gains and
   actual onended-to-pool reuse, including the prior unity-reset timeline; `22.42` and an unmodified native
   replay are controls. Seed the fade's effective intended value before `source.start`, including equal-time
   outgoing plateaus and nonzero drawn progress; preserve envelope and frozen unity. Reverting only the fresh or
   pooled seed must fail the named first-sample PCM comparison. A mocked `source.start` snapshot proves
   construction, not rendered audio.
8. **MIDI note correlation crosses the rack boundary.** When a transform stores a Note On decision for a later
   Note Off, drive supplied `noteInstanceId` values through `MidiRack`: one equal-pitch note, change the deciding
   parameter while held, then attack and release a second identity first. Assert emitted identity and pitch or
   suppression; channel/pitch FIFO must fail. Keep identityless FIFO apart.
9. **Expression ordering around note release (#805).** A note-on can await a Yeast worker round trip, so
   expression arriving behind it either overtakes it (the opening bend finds no channel-to-note entry and is
   dropped) or, if serialized behind every note event, waits for an unrelated channel and voices late. Hold the
   first note-on's promise, then send channel pressure, CC74, pitch bend, the note-off and the next note-on on
   the same channel: `handleWebMidiMessage.spec.ts` (`commits release only after admitted member expression,
before the next note on that channel`) must observe exactly `on60, pressure, slide, bend, off60, on62`. A
   bend on an idle unrelated channel voices at its own arrival frame (`should not delay expression past its
arrival frame behind an unrelated note-on`). Running expression immediately instead of behind its
   channel's tail in `dispatchExpressionHandler` must fail the release-order case; queuing expression behind
   the global note tail (`midiInputTail`) must fail the unrelated-channel case.
10. **A boundary known in advance must not wait for the look-ahead window.** A main-thread stall longer than the
    look-ahead lets anything a window has not yet reached fall due unscheduled and join late, mid-buffer. Comp
    parts of one clip keyed and gated separately schedule the take after a comp boundary only when a window
    reaches it, so a stall after Play drops its head. Schedule one window that reaches only the part before the
    boundary, jump the clock past the boundary, run the next window, and assert the next part's
    `start(when, offset)` received its exact boundary instant and region entry, not a late `now` with an elapsed
    offset.
11. **A live edit cuts sources it supersedes, including ones not yet sounding.** An edit during playback reaches
    the scheduler only as its next resolution; dedup keys that change with the edit, or omit what the edit
    changed (a take swapped over the same region), leave the emitted source sounding under or instead of the new
    one. Schedule, edit (comp, take swap, mute, and a part scheduled ahead), run the next pass, and assert `stop`
    on every superseded source before its start and exactly one `start` for the new content; an unchanged pass
    calls neither.
12. **Recorded MIDI shares its admitted media origin (#5891).** At 120 BPM with 30 ms latency, require the real
    compensated downbeat at source 0 and held out 1.09 rather than 1.03: onset, expression, off and Stop
    subtract `startBeat − midiOffsetBeats` before clamping, preserving captured pass origins across loop edits.
    Removing the media-origin adjustment must fail the endpoint; adding it after clamping must fail the downbeat.
    Strike at 11.02 for out 11.03, release before out and hold after out, with zero and nonzero lead-in: the
    ordinary 0.0625 minimum cannot extend the automatic-owned source cap. Key-up and sealing emit no zero-length
    or malformed note when no positive interval remains; the ordinary manual no-cap minimum stays a control.
    Owner lifetime: `session-lifecycle.md` probe 12; no hardware MIDI claim.
13. **Queued loop passes are admitted with their own media before a stall (#6277).** At 48 kHz and 120 BPM,
    fill a 2 s loop with unequal canonical source entries, then complete the last refill 125 ms before its seam.
    Freeze the actual `source.start(when, offset, duration)` and stop ledger before withholding ticks for 200 ms.
    The successor must already own the mapped seam, original entry, rate and exclusive ending; recovery neither
    restarts it late nor stops it with the dying pass. Repeat with a 125 ms loop crossing multiple seams,
    stretched or comped material and frozen audio and MIDI. Same clip and buffer IDs do not authenticate future
    content: replace the actual cached buffer under its existing ID, or edit entry, comp, gain, fade or
    envelope, and require retirement before each old future start, including one less than 5 ms away; unchanged
    material survives. Advance the context clock during preparation: tick-entry time cannot certify the lead
    remaining at completion. Require the actual completed coverage, its recorded completion audio timestamp, a
    one-frame-beyond retained-lead control and mapped recovery beyond coverage; bound work under an unmoving
    monotonic clock and tiny legal loops, and name actual unadmitted coverage on shortfall. Admission that waits
    for the old window, prepares only one successor, skips future-input reconciliation or clears promoted-pass
    keys must fail `startPlayheadSchedulerLoopAudioStall.spec.ts`.
14. **Recovered clocks do not prove rendered loop continuity (#6277).** Runs: author. Capture real Chromium
    programme PCM through a 200 ms main-thread block across a loop seam and compare an unstalled reference for
    missing intervals, phase and duplicates, including existing fades. From the fixed commit, the reviewer checks
    only that no claim of continuity rests on source-call ledgers, positive meters, recovered wrap counts or an
    admission benchmark; those are probe 13's evidence, not rendered signal.
