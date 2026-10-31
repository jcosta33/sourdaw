import { captureEventPositionAt } from './captureEventBeat';
import { type CapturedInputEventTime } from './resolveInputEventTime';

type ResolveAdmittedEventPositionInput = {
    timeStamp: number | CapturedInputEventTime | undefined;
    eventTime: number;
};

export function resolveAdmittedEventPosition({ timeStamp, eventTime }: ResolveAdmittedEventPositionInput): {
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
