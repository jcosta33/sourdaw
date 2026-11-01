import { getAudioSourcePositionSeconds } from '#/utils/audioSourceTime';

import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

type ReversibleAudioSource = Pick<
    Clip,
    | 'startBeat'
    | 'endBeat'
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
    | 'stretchMode'
    | 'stretchRatio'
>;

export type ReversedAudioSourceFields = Pick<
    Clip,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;

/**
 * The canonical counterpart of `reversedClipAudioOffsetBeats`. The readers
 * play `[E, X)`, where `X` is the source second they reach at the clip end
 * through the tempo map at the stretch rate; after the whole buffer of `D`
 * seconds is mirrored that passage lives at `[D − X, D − E)`, so the entry
 * becomes `D − X`, an involution while span, map and rate hold. The mirrored
 * buffer is a fresh media basis whose repeat grid opens at the mirrored head
 * (the loop law `reverseClip` restamps its anchor by), so each provenance
 * field present restamps to the fresh-region value; an absent one stays
 * absent, since readers already default it to that value.
 *
 * `undefined` for a beat-only clip, whose legacy offset remap stays the only
 * authority; `null` when a canonical entry cannot be mirrored.
 */
export function reversedClipAudioSource(
    clip: ReversibleAudioSource,
    bufferDurationSeconds: number,
    secondsAtBeat: (beat: number) => number
): ReversedAudioSourceFields | null | undefined {
    if (clip.audioOffsetSeconds === undefined) {
        return undefined;
    }
    if (!Number.isFinite(bufferDurationSeconds) || bufferDurationSeconds <= 0) {
        return null;
    }
    const exitSeconds = getAudioSourcePositionSeconds(
        clip.audioOffsetSeconds,
        secondsAtBeat(clip.endBeat) - secondsAtBeat(clip.startBeat),
        consumedStretchFactor(clip)
    );
    const entrySeconds = bufferDurationSeconds - exitSeconds;
    if (!Number.isFinite(entrySeconds)) {
        return null;
    }
    const fields: ReversedAudioSourceFields = { audioOffsetSeconds: entrySeconds };
    if (clip.audioUnwrappedOffsetSeconds !== undefined) {
        fields.audioUnwrappedOffsetSeconds = entrySeconds;
    }
    if (clip.audioLoopStartSeconds !== undefined) {
        fields.audioLoopStartSeconds = entrySeconds;
    }
    if (clip.audioLoopPassEntrySeconds !== undefined) {
        fields.audioLoopPassEntrySeconds = entrySeconds;
    }
    if (clip.audioLoopPassOriginBeat !== undefined) {
        fields.audioLoopPassOriginBeat = clip.startBeat;
    }
    return fields;
}
