import { type AudioSourceStateSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';

import { captureAudioSourceState } from './captureAudioSourceState';

export function audioSourceStateMatches(
    clip: Pick<Clip, 'audioOffsetSeconds' | 'audioOffsetBeats' | 'audioLoopStartSeconds' | 'loopEnabled'>,
    expected: AudioSourceStateSnapshot
): boolean {
    const current = captureAudioSourceState(clip);
    return (
        (expected.audioLoopStartSeconds === undefined ||
            Object.is(current.audioLoopStartSeconds, expected.audioLoopStartSeconds)) &&
        Object.is(current.audioOffsetSeconds, expected.audioOffsetSeconds) &&
        Object.is(current.audioOffsetBeats, expected.audioOffsetBeats)
    );
}
