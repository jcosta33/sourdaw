import { armRecording } from '../../repositories/crumbsBridge/armRecording';
import { padStore } from '../../stores/padStore';

/** Clamp a number into [min, max]; non-finite input collapses to `min`. */
function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}

/**
 * Arms threshold capture after validating the parameters the Rust side would
 * otherwise silently reject (a `targetPad` past the last pad never reports back
 * to the UI). `targetPad` is clamped against the live pad count; `threshold` to
 * 0..1; `maxDurationSecs` to a strictly positive value.
 *
 * Resolves `true` only when the recorder was actually armed. An instance with
 * no pads has nothing to capture into and is refused here, before the bridge —
 * a resolved promise either way would report an open take to a caller that has
 * none, and the recorder's readout is transport state a musician trusts. A
 * refusal raised by the backend still rejects.
 */
export async function armCrumbsRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<boolean> {
    const padCount = padStore.value?.[instanceId]?.pads.length ?? 0;
    if (padCount === 0) {
        return false;
    }

    const safeThreshold = clamp(threshold, 0, 1);
    const safeTargetPad = clamp(Math.round(targetPad), 0, padCount - 1);
    const safeMaxDuration = Number.isFinite(maxDurationSecs) && maxDurationSecs > 0 ? maxDurationSecs : 1;

    await armRecording(instanceId, safeThreshold, safeTargetPad, safeMaxDuration);
    return true;
}
