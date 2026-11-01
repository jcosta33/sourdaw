import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type Clip } from './Track';

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

/**
 * Put a captured source clock back whole: a key the capture lacks is restored
 * absent, never left at the live value. `null` when the result is not an exact
 * source state, so a malformed capture cannot reach the readers.
 */
export function replaceClipAudioSource(clip: Clip, source: ClipAudioSourceFields): Clip | null {
    const {
        audioOffsetSeconds: _entry,
        audioUnwrappedOffsetSeconds: _unwrapped,
        audioLoopStartSeconds: _loopStart,
        audioLoopPassEntrySeconds: _passEntry,
        audioLoopPassOriginBeat: _passOrigin,
        ...rest
    } = clip;
    const next: Clip = { ...rest, ...source };
    return hasExactAudioSourceFields(next) ? next : null;
}

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
