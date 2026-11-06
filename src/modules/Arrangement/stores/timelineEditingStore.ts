import { createStore } from '#/infra/store/createStore';

// How timeline edits behave and which automation lanes the timeline draws:
// ripple mode, the snap grid, automation lane visibility and the inline
// sub-lanes under each track. The ripple planners, the transient quantizer and
// the sub-lane hit test read it, so it lives beside them rather than in the
// shell. Session UI state: memory-backed, never saved into the project.

export type AutomationVisibility = 'hidden' | 'overlay' | 'panel';

export type TimelineEditingState = {
    rippleEditing: boolean;
    /** Snap grid in beats. */
    snapValue: number;
    automationVisibility: AutomationVisibility;
    /** Track id to the parameter ids shown inline under that track. */
    automationSubLanes: Record<string, string[]>;
};

export const defaultTimelineEditingState: TimelineEditingState = {
    rippleEditing: false,
    snapValue: 1,
    automationVisibility: 'hidden',
    automationSubLanes: {},
};

export const timelineEditingStore = createStore<TimelineEditingState>({
    initialData: defaultTimelineEditingState,
});
