# AudioParam frame timing

`AudioContext.currentTime` is a frame count divided by the sample rate. The quotient can sit a
hair above its integer frame, and Chromium applies an AudioParam event whose time exceeds a frame
on the next sample. A write meant for "now" or for an already reached frame must be scheduled at
the exact encoded current frame, never at raw `currentTime`, or the first rendered sample after a
change keeps the old value.

## Standing probe

Drive a fake context whose `currentTime` is `n / sampleRate` with `n * sampleRate` evaluating above
`n` (896 / 48000 does). Assert the scheduled time of every immediate and already reached write
lands on frame `n` after `Math.ceil(time * sampleRate)`. Asserting the raw `currentTime` value
pins the defect instead of observing it.

### 2026-10-31 — immediate Transient Shaper gains landed one sample late (introduced by PR #5867)

PR #5867 (`e35d5c4f07`) encoded future gain, ramp and reset frames exactly but scheduled immediate
writes at raw `currentTime`. Its unit case asserted that raw value, so it passed while the browser
case re-entering from bypass in a suspended context read the pre-change gain on its first sample.
No stance attacked the sample on which a parameter change takes effect.
