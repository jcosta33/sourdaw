import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type Clip } from '../../models/Track';
import { relocateAudioSourceTimeFields } from '../clip/relocateAudioSourceTimeFields';

import { audioSourceAtBeat } from './audioSourceAtBeat';

/** Capture the retained source under the old clock, then relocate only its pass anchor. */
export function prepareAudioClipCutFields(clip: Clip, retainedBeat: number, placementDeltaBeats: number) {
    if (clip.type !== 'audio') {
        return {};
    }
    if (!hasExactAudioSourceFields(clip)) {
        return null;
    }
    const source = audioSourceAtBeat(clip, retainedBeat);
    if (!source) {
        return null;
    }
    const fields = relocateAudioSourceTimeFields(source, placementDeltaBeats);
    if ('loopLength' in source && typeof source.loopLength === 'number') {
        return { ...fields, loopLength: source.loopLength };
    }
    return fields;
}
