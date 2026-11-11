import { replaceTimelineWorkingView, type TimelineWorkingView } from '../stores/timelineViewStore';

export function restoreTimelineWorkingView(
    view: TimelineWorkingView,
    options: { deferViewportClamp?: boolean } = {}
): void {
    replaceTimelineWorkingView(view, options);
}

export function resetTimelineWorkingView(): void {
    replaceTimelineWorkingView(null);
}
