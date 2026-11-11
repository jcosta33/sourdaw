import { replaceTimelineWorkingView, type TimelineWorkingView } from '../stores/timelineViewStore';

export function restoreTimelineWorkingView(view: TimelineWorkingView): void {
    replaceTimelineWorkingView(view);
}

export function resetTimelineWorkingView(): void {
    replaceTimelineWorkingView(null);
}
