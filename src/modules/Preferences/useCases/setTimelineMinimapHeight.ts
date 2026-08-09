import { normalizeTimelineMinimapHeight } from '#/utils/TimelineMinimap/timelineMinimapHeight';

import { preferencesStore } from '../stores/preferencesStore';

export function setTimelineMinimapHeight(height: number): void {
    const preferences = preferencesStore.value;
    if (!preferences) {
        return;
    }

    preferencesStore.trySet({
        ...preferences,
        timelineMinimapHeight: normalizeTimelineMinimapHeight(height),
    });
}
