import { type AudioSourceStateSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';

import { captureAudioSourceState } from './captureAudioSourceState';

export function audioSourceStateMatches(
    clip: Pick<Clip, 'audioOffsetSeconds' | 'audioOffsetBeats'>,
    expected: AudioSourceStateSnapshot
): boolean {
    const current = captureAudioSourceState(clip);
    return (
        Object.is(current.audioOffsetSeconds, expected.audioOffsetSeconds) &&
        Object.is(current.audioOffsetBeats, expected.audioOffsetBeats)
    );
}
