# AudioParam frame timing

`AudioContext.currentTime` is a frame count divided by the sample rate. The quotient can sit a
hair above its integer frame, and Chromium applies an AudioParam event whose time exceeds a frame
on the next sample. A future write must be scheduled at the exact encoded frame, never at the raw
quotient. A write meant for "now" or for an already reached frame cannot reach that frame through
an AudioParam at all: Chromium clamps any event time below `currentTime` up to `currentTime`, so on
such a frame an a-rate value lands one sample late and a k-rate value a whole quantum late. A
device whose re-entry or immediate change must hold on the frame a suspended context resumes on
carries it through its port as well.

## Standing probe

Drive a fake context whose `currentTime` is `n / sampleRate` with `n * sampleRate` evaluating above
`n` (896 / 48000 does). Assert the scheduled time of every immediate and already reached write
lands on frame `n` after `Math.ceil(time * sampleRate)`. Asserting the raw `currentTime` value
pins the defect instead of observing it. That probe covers future writes only; a fake context
cannot show Chromium's clamp, so an immediate write needs the real-Chromium probe in the lesson
below.

### 2026-10-31 — immediate Transient Shaper gains landed one sample late (introduced by PR #5867)

PR #5867 (`e35d5c4f07`) encoded future gain, ramp and reset frames exactly but scheduled immediate
writes at raw `currentTime`. Its unit case asserted that raw value, so it passed while the browser
case re-entering from bypass in a suspended context read the pre-change gain on its first sample.
No stance attacked the sample on which a parameter change takes effect.

### Encoded immediate writes were clamped back to the late frame (introduced by PR #5867)

The repair above encoded immediate and already reached writes one representable step below the
raw quotient. Chromium clamps that time back up to `currentTime`, so on the pause frames whose
quotient sits above the integer the resumed sample still carried the old gains and the k-rate
bypass reset landed a quantum late; the browser case failed only when its pause happened to land
on such a frame. The fake-context probe asserted the encoded time and could not see the clamp. A
probe that would have caught it runs real Chromium: suspend, resume and suspend again until the
suspended frame sits above its integer frame, make the write, resume, and capture the first
rendered quantum; or suspend an `OfflineAudioContext` at every quantum and write through the
AudioParam alone, which shows where the clamp moves the event.

## Escape: the playhead scheduler capped its advance on a wrong `currentTime` premise

Commit `7de4d3ddd9` capped each scheduler tick's advance at the look-ahead (`MAX_DELTA_SECONDS`),
on the stated premise that a suspended context leaps `currentTime` forward by the whole gap. The
Web Audio specification says the opposite: `currentTime` counts rendered frames and stops while the
context is suspended. A tick later than the look-ahead therefore only happens when the main thread
stalls while audio keeps rendering, and the cap threw that span away, leaving the transport behind
the sources already playing on the audio clock. A clip ending at a loop seam then left the shortfall
as silence before the next pass; #5914's audition test caught the dropout on an unrelated head.
`6681b5bf50` later pinned the cap with a coverage test that asserted the clamped advance, so the
check guarded the defect instead of the clock.

Probe that would have caught it: advance a fake audio clock by more than the look-ahead between
two ticks while the context stays running, then require the playhead position, the next pass's
seam time and the scheduling window to follow the whole clock span. Read the platform clock rule
from the specification before accepting a comment's claim about it.
