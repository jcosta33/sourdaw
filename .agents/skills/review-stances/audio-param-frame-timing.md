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

### 2026-11-01 — an exclusive audition heard the programme's first resumed sample (introduced by PR #5914)

PR #5914 (`0a341aef22`) closed the live programme for a measured audition with a gain gate written
at raw `currentTime`, made while the context was still suspended before resume. On a resume frame
whose quotient sits above its integer frame the gate closed one sample late, and the browser case
read a nonzero programme sample on the first resumed frame about one run in five. Its browser case
asserted the gate's event time equal to `currentTime`, which pinned the defect, and its unit
fixtures applied every gain write at once. The repair gates by the edge instead: a disconnect or
connect is a control message the rendering loop runs before the next quantum it renders, so it
holds from that quantum's first frame, suspended or running. A probe that would have caught it
renders from such a frame through a fixture applying Chromium's step rule (a time clamped up to
`currentTime`, taking effect on the first frame at or after it) and asserts the first sample.
