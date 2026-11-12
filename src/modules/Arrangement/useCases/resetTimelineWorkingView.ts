import { replaceTimelineWorkingView } from '../stores/timelineViewStore';

export function resetTimelineWorkingView(): void {
    replaceTimelineWorkingView(null);
}
