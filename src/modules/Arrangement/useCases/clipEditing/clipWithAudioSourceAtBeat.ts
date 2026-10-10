import { type Clip } from '../../models/Track';

import { audioSourceAtBeat } from './audioSourceAtBeat';

export function clipWithAudioSourceAtBeat(clip: Clip, beat: number): Clip {
    if (clip.type !== 'audio') {
        return clip;
    }
    return { ...clip, ...audioSourceAtBeat(clip, beat) };
}
