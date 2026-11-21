import { trackStore } from '../../stores/trackStore';
import { revealTrackInViews } from '../revealTrackInViews';

import { selectTrack } from './selectTrack';

/**
 * Selects a track from a view that draws hidden tracks. The track selection
 * never rests on a track the views hide, so a hidden track is revealed first.
 */
export function selectTrackRevealingHidden(trackId: string): void {
    revealTrackInViews(trackStore.value?.tracks ?? [], trackId);
    selectTrack(trackId);
}
