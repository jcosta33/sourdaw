import { captureEventPositionAt } from './captureEventBeat';
import { type CapturedInputEventTime } from './resolveInputEventTime';

type ResolveAdmittedEventBeatInput = {
    timeStamp: number | CapturedInputEventTime | undefined;
    /** The event's own instant on the AudioContext clock, from `resolveInputEventTime`. */
    eventTime: number;
};

/**
 * The timeline beat a live event was admitted at: the dispatcher's capture when
 * it supplied one, otherwise projected from the event's own instant (#4875).
 */
export function resolveAdmittedEventBeat({ timeStamp, eventTime }: ResolveAdmittedEventBeatInput): number {
    if (typeof timeStamp === 'object' && timeStamp !== null && Number.isFinite(timeStamp.recordingBeat)) {
        return timeStamp.recordingBeat!;
    }
    // No dispatcher-captured beat: derive it from this event's own instant
    // anyway (#4875).
    return captureEventPositionAt({ audioTime: eventTime }).beat;
}

export function resolveAdmittedEventPosition({ timeStamp, eventTime }: ResolveAdmittedEventBeatInput): {
    beat: number;
    passIndex: number;
} {
    if (
        typeof timeStamp === 'object' &&
        timeStamp !== null &&
        Number.isFinite(timeStamp.recordingBeat) &&
        Number.isSafeInteger(timeStamp.recordingPassIndex) &&
        timeStamp.recordingPassIndex! >= 0
    ) {
        return { beat: timeStamp.recordingBeat!, passIndex: timeStamp.recordingPassIndex! };
    }
    const captured = captureEventPositionAt({ audioTime: eventTime });
    if (typeof timeStamp !== 'object' || timeStamp === null) {
        return captured;
    }
    return {
        beat: Number.isFinite(timeStamp.recordingBeat) ? timeStamp.recordingBeat! : captured.beat,
        passIndex:
            Number.isSafeInteger(timeStamp.recordingPassIndex) && timeStamp.recordingPassIndex! >= 0
                ? timeStamp.recordingPassIndex!
                : captured.passIndex,
    };
}
