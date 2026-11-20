import { automationStore } from '#/modules/Automation/stores';

import { timelineEditingStore } from '../stores/timelineEditingStore';
import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';

/** Keep shared scroll offsets in bounds when their content extents change. */
export function initTimelineScrollClamp(): () => void {
    const clampY = () => setScrollY(timelineViewStore.value?.scrollY ?? 0);
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
    return () => {
        stopTracks();
        stopEditing();
        stopAutomation();
    };
}
