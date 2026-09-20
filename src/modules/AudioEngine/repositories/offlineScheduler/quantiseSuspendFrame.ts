/**
 * The frame an `OfflineAudioContext` will actually suspend at, for a requested
 * sample frame.
 *
 * Irreducible reason for rounding DOWN: `OfflineAudioContext.suspend(time)`
 * rounds `time` down to the nearest render quantum boundary (render quantum =
 * 128 frames), and rejects the returned promise when that quantised frame is
 * greater than or equal to the total render duration. A write is therefore
 * reachable exactly when its quantised suspend frame is strictly inside the
 * render.
 */
export const RENDER_QUANTUM_FRAMES = 128;

/** `frame - (frame % RENDER_QUANTUM_FRAMES)`: the frame's render-quantum boundary. */
export function quantiseSuspendFrame(frame: number): number {
    return frame - (frame % RENDER_QUANTUM_FRAMES);
}
