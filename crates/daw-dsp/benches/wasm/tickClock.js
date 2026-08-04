/**
 * A high-resolution clock an `AudioWorkletGlobalScope` can actually read.
 *
 * **Chrome does not expose `performance` inside an AudioWorklet.** Probed on
 * Chrome 150: `typeof performance === 'undefined'`, and the only clock-shaped
 * globals present are `Date` (1 ms) and `currentTime` (the audio clock, which
 * under an `OfflineAudioContext` advances by exactly one quantum per render
 * call regardless of how long that call took, so it measures nothing). Neither
 * can resolve a device that costs 20 us.
 *
 * `SharedArrayBuffer` and `Atomics` *are* exposed, so this worker becomes the
 * clock: it spins incrementing a counter in shared memory, and the worklet
 * reads that counter either side of a render. The page converts ticks to
 * milliseconds with a calibration it takes against its own `performance.now()`,
 * before and after the run, and reports both so drift in the spin rate is
 * visible rather than assumed away.
 *
 * What this costs the measurement, stated because it is inside the timed
 * region: each `Atomics.load` from the worklet is a coherence miss against the
 * line this worker is writing. The harness measures that overhead directly —
 * the "harness floor" row is two back-to-back reads with no render between
 * them — and every device figure should be read as sitting on top of it.
 */

const buffer = new SharedArrayBuffer(4);
const ticks = new Int32Array(buffer);

self.postMessage({ type: 'clock', buffer });

let value = 0;
// Deliberately unbounded. The worker is terminated by the page when the run
// ends; there is nothing else for it to do and any sleep would coarsen the
// clock to the sleep interval.
for (;;) {
    value = (value + 1) | 0;
    Atomics.store(ticks, 0, value);
}
