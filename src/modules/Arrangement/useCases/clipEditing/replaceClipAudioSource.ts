import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type Clip } from '../../models/Track';

import { type ClipAudioSourceFields } from './clipAudioSourceFields';

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
