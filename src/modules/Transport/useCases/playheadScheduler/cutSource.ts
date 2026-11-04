import { type SourceWithFade } from '../../models/SourceWithFade';

/**
 * Cut one source through its optional fade, the ramp ending at `stopAt`. The
 * default is the teardown semantic: one 5 ms ramp after the current clock. An
 * already-stopped node is skipped silently.
 */
export function cutSource(src: SourceWithFade, ctx: BaseAudioContext, stopAt = ctx.currentTime + 0.005): void {
    const now = ctx.currentTime;
    try {
        if (src.fadeGainNode) {
            const fadeStart = Math.max(stopAt - 0.005, now);
            src.fadeGainNode.gain.cancelScheduledValues(now);
            src.fadeGainNode.gain.setValueAtTime(src.fadeGainNode.gain.value, fadeStart);
            src.fadeGainNode.gain.linearRampToValueAtTime(0, stopAt);
        }
        src.stop(stopAt);
    } catch {
        /* already stopped */
    }
}
