import { type Clip } from '../../models/Track';

export type ClipAudioSourceFields = Pick<
    Clip,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;

/** The canonical source clock a clip carries, or `undefined` for a beat-only clip. */
export function captureClipAudioSource(clip: ClipAudioSourceFields): ClipAudioSourceFields | undefined {
    if (clip.audioOffsetSeconds === undefined) {
        return undefined;
    }
    const fields: ClipAudioSourceFields = { audioOffsetSeconds: clip.audioOffsetSeconds };
    if (clip.audioUnwrappedOffsetSeconds !== undefined) {
        fields.audioUnwrappedOffsetSeconds = clip.audioUnwrappedOffsetSeconds;
    }
    if (clip.audioLoopStartSeconds !== undefined) {
        fields.audioLoopStartSeconds = clip.audioLoopStartSeconds;
    }
    if (clip.audioLoopPassEntrySeconds !== undefined) {
        fields.audioLoopPassEntrySeconds = clip.audioLoopPassEntrySeconds;
    }
    if (clip.audioLoopPassOriginBeat !== undefined) {
        fields.audioLoopPassOriginBeat = clip.audioLoopPassOriginBeat;
    }
    return fields;
}
