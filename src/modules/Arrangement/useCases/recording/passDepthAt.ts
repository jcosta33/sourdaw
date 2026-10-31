import { type RecordingPassOrigin } from '../../stores/activeRecordingRef';

/** A pass's source beat at the clip start, the offset its take is played with. */
export function passDepthAt(origin: RecordingPassOrigin): number {
    return origin.unwrappedBeat - origin.beat;
}
