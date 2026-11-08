import { type SourceWithFade } from '../../models/SourceWithFade';

/** Preserve the source's earlier envelope; a physical seam fence owns only its final ramp. */
export function fenceSource(source: SourceWithFade, context: BaseAudioContext, stopAt: number): void {
    if (
        source.scheduledStopTime === stopAt ||
        (source.scheduledEndTime !== undefined && source.scheduledEndTime <= stopAt)
    )
        return;
    const now = context.currentTime;
    const end = Math.max(now, stopAt);
    if (source.fadeGainNode) {
        const fadeStart = Math.max(now, source.scheduledStartTime ?? now, end - 0.005);
        source.fadeGainNode.gain.cancelAndHoldAtTime(fadeStart);
        source.fadeGainNode.gain.linearRampToValueAtTime(0, end);
    }
    source.stop(end);
    source.scheduledStopTime = end;
}
