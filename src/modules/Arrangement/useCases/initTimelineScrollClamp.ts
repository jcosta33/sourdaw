import { automationStore } from '#/modules/Automation/stores';
import { preferencesStore } from '#/modules/Preferences/stores';

import { timelineEditingStore } from '../stores/timelineEditingStore';
import { getTimelineTrackHeightMode } from '../stores/timelineTrackHeightPreference';
import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';

/** Keep shared scroll offsets in bounds when their content extents change. */
export function initTimelineScrollClamp(): () => void {
    function clampY(): void {
        setScrollY(timelineViewStore.value?.scrollY ?? 0);
    }

    const stopTracks = trackStore.subscribe(() => {
        setScrollX(timelineViewStore.value?.scrollX ?? 0);
        clampY();
    });
    const stopEditing = timelineEditingStore.subscribe(clampY);
    const stopAutomation = automationStore.subscribe(() => {
        if (timelineEditingStore.value?.automationVisibility === 'overlay') {
            clampY();
        }
    });
    let heightMode = getTimelineTrackHeightMode();
    const stopPreferences = preferencesStore.subscribe(() => {
        const nextMode = getTimelineTrackHeightMode();
        if (nextMode !== heightMode) {
            heightMode = nextMode;
            clampY();
        }
    });
    return () => {
        stopTracks();
        stopEditing();
        stopAutomation();
        stopPreferences();
    };
}
