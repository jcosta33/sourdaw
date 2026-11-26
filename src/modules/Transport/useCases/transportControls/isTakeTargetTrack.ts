import { getTrackEligibility, isFrozenTrackRefusingRecording } from '#/modules/Arrangement/stores';

import type { trackStore } from '#/modules/Arrangement/stores';

type Track = NonNullable<typeof trackStore.value>['tracks'][number];

/**
 * Whether `startRecording` would open a take on this track: armed, of a kind
 * that records, and not frozen, since a frozen track plays only its buffer.
 * Every route that decides a take can start reads this one rule.
 */
export function isTakeTargetTrack(track: Pick<Track, 'armed' | 'kind' | 'frozen'>): boolean {
    return track.armed && getTrackEligibility(track.kind).acceptsRecording && !isFrozenTrackRefusingRecording(track);
}
