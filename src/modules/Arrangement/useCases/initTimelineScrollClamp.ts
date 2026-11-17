import { preferencesStore } from '#/modules/Preferences/stores';

import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';

/**
 * Re-clamps both scroll offsets whenever the track list changes, so deleting
 * tracks, clips or folders cannot leave blank canvas beyond the new extent.
 * A denser track-height preference can also shrink the vertical extent.
 */
export function initTimelineScrollClamp(): () => void {
    function clampVertical(): void {
        setScrollY(timelineViewStore.value?.scrollY ?? 0);
    }
    const stopTracks = trackStore.subscribe(() => {
        setScrollX(timelineViewStore.value?.scrollX ?? 0);
        clampVertical();
    });
    let heightMode = preferencesStore.value?.trackHeight;
    const stopPreferences = preferencesStore.subscribe((preferences) => {
        if (preferences?.trackHeight !== heightMode) {
            heightMode = preferences?.trackHeight;
            clampVertical();
        }
    });
    return () => {
        stopTracks();
        stopPreferences();
    };
}
