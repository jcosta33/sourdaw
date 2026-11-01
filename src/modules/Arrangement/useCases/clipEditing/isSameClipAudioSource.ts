import { type ClipAudioSourceFields } from './clipAudioSourceFields';

/** Whether two clocks name the same keys with the same values. */
export function isSameClipAudioSource(left: ClipAudioSourceFields, right: ClipAudioSourceFields): boolean {
    return (
        left.audioOffsetSeconds === right.audioOffsetSeconds &&
        left.audioUnwrappedOffsetSeconds === right.audioUnwrappedOffsetSeconds &&
        left.audioLoopStartSeconds === right.audioLoopStartSeconds &&
        left.audioLoopPassEntrySeconds === right.audioLoopPassEntrySeconds &&
        left.audioLoopPassOriginBeat === right.audioLoopPassOriginBeat
    );
}
