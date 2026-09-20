/**
 * The render-quantum frame `OfflineAudioContext.suspend(when)` actually
 * suspends at.
 *
 * Blink rounds the requested time UP to the render quantum: it computes
 * `frame = when * sampleRate()` and then `RoundUpToMultiple(frame, 128)`. A
 * live headless-Chromium probe confirmed the direction — `suspend(24000/48000)`
 * fired at frame 24064 = `ceil(24000 / 128) * 128` (evidence:
 * ~/.agents/artifacts/4489-suspend-quantisation/RESULTS.md). Rounding DOWN
 * would give 23936, which is wrong (MDN describes it wrongly too).
 *
 * The offline frame scheduler keys its batches on this frame so two calls that
 * land inside one quantum register a single suspend. A second suspend for an
 * already-scheduled quantum frame is rejected with InvalidStateError, so the
 * scheduler must never register more than one per quantum.
 */

export const RENDER_QUANTUM_FRAMES = 128;

export function quantiseSuspendFrame(frame: number): number {
    return Math.ceil(frame / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES;
}
