import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';

/**
 * Re-clamps both scroll offsets whenever the track list changes, so deleting
 * tracks, clips or folders cannot leave blank canvas beyond the new extent.
 */
export function initTimelineScrollClamp(): () => void {
    return trackStore.subscribe(() => {
        setScrollX(timelineViewStore.value?.scrollX ?? 0);
        setScrollY(timelineViewStore.value?.scrollY ?? 0);
    });
}
