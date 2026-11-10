import { nativeRecordingEntry } from '../playheadScheduler/nativeRecordingEntry';

type NativeCaptureSnapshot = Parameters<typeof nativeRecordingEntry>[0];

/** Only a sounded tempo epoch may change the date within the same owned occurrence. */
export function redateNativePunchEnding(
    target: { outBeat: number; contextSeconds: number; anchor: NativeCaptureSnapshot },
    observation: NativeCaptureSnapshot
) {
    const first =
        observation.observations?.find((point) => point.admission.serial === observation.admission.serial) ??
        observation;
    if (
        observation.forwardAuthorized === false ||
        first.forwardAuthorized === false ||
        first.contextSeconds > observation.audibleContextSeconds ||
        first.admission.serial === target.anchor.admission.serial ||
        first.admission.located ||
        first.clockIdentity !== target.anchor.clockIdentity ||
        first.loopWraps !== target.anchor.loopWraps
    ) {
        return target;
    }
    const entry = nativeRecordingEntry(first, first.contextSeconds);
    if (entry.beat > target.outBeat) {
        return target;
    }
    const previousSeconds =
        target.anchor.geometry.secondsAtBeat(target.outBeat) - target.anchor.geometry.secondsAtBeat(entry.beat);
    const nextSeconds = first.geometry.secondsAtBeat(target.outBeat) - first.geometry.secondsAtBeat(entry.beat);
    if (previousSeconds === nextSeconds) {
        return target;
    }
    return { outBeat: target.outBeat, contextSeconds: entry.contextSeconds + nextSeconds, anchor: first };
}
