import { takeLaneStore } from '../stores/takeLaneStore';
import { trackStore } from '../stores/trackStore';
import { runWithTempoAudioSourceTrackIntent } from '../stores/tempoAudioSourceWriteIntent';
import { runWithTakeLaneWriteIntent } from '../stores/takeLaneWriteJournal';

import { prepareTempoAudioSourceWrite } from './comping/prepareTempoAudioSourceWrite';

/** Source-only facets join the caller's existing project transaction. Private
 * intent is minted at each synchronous set, before listeners can run. */
export function applyTempoAudioSources(
    input: Parameters<typeof prepareTempoAudioSourceWrite>[0]
): 'written' | 'conflict' {
    const prepared = prepareTempoAudioSourceWrite(input);
    if (!prepared) {
        return 'conflict';
    }
    const { tracks, lanes, projected, intent } = prepared;
    if (intent.promotion.clips.length > 0) {
        if (!tracks) {
            return 'conflict';
        }
        runWithTempoAudioSourceTrackIntent(intent, () => trackStore.set({ ...tracks, tracks: projected.tracks }));
    }
    if (intent.promotion.takes.length + intent.promotion.regions.length + intent.promotion.gaps.length > 0) {
        if (!lanes) {
            return 'conflict';
        }
        runWithTakeLaneWriteIntent({ kind: 'tempo-audio-sources', intent }, () =>
            takeLaneStore.set({ ...lanes, lanes: projected.lanes })
        );
    }
    return 'written';
}
