import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { type TrackStoreState, trackStore } from '../stores/trackStore';

import { captureRelinkAudioSourceTargets } from './clipEditing/captureRelinkAudioSourceTargets';
import { relinkAudioSourceTargetsMatch } from './clipEditing/relinkAudioSourceTargetsMatch';

type RelinkAudioSourceEligibility = 'eligible' | 'frozen' | 'blocked' | 'missing';

/** Read every live and inactive alias through the same target law used by relink. */
export function readRelinkAudioSourceEligibility(
    sourceBufferId: string,
    state: TrackStoreState | null = trackStore.value
): RelinkAudioSourceEligibility {
    if (!sourceBufferId || getCachedAudioBuffer({ bufferId: sourceBufferId }) !== null) {
        return 'missing';
    }
    const targets = captureRelinkAudioSourceTargets(sourceBufferId, `${sourceBufferId}:relink-eligibility`, state);
    if (targets.length === 0) {
        return 'missing';
    }
    if (relinkAudioSourceTargetsMatch(targets, undefined, state)) {
        return 'eligible';
    }
    const ownerIds = new Set(targets.map((target) => target.trackId));
    if (
        state?.tracks.some(
            (track) => ownerIds.has(track.id) && (track.frozen || track.freezeState.status !== 'unfrozen')
        )
    ) {
        return 'frozen';
    }
    return 'blocked';
}
