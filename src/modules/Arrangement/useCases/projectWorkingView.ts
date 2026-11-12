import { replaceTimelineWorkingView, type TimelineWorkingView } from '../stores/timelineViewStore';

export function restoreTimelineWorkingView(
    view: TimelineWorkingView,
    options: { deferViewportClamp?: boolean } = {}
): void {
    replaceTimelineWorkingView(view, options);
}
