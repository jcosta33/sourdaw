import { setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';

/**
 * Re-clamps the vertical scroll offset whenever the track list changes, so a
 * deleted track or collapsed folder never leaves blank canvas below the last
 * row until the next wheel event. It lives with the stores rather than any
 * view, so it holds whether or not the header list is mounted.
 */
export function initTimelineScrollClamp(): () => void {
    return trackStore.subscribe(() => {
        setScrollY(timelineViewStore.value?.scrollY ?? 0);
    });
}
