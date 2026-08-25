/**
 * Ephemeral registry slot for the currently mounted timeline gesture
 * canceler. `useTimelineInteractions` keeps it current via
 * `registerTimelineGestureCanceler`; the global Escape path (CommandInterface
 * `handleKeydown`) invokes it through `cancelActiveTimelineGesture`.
 *
 * Gesture state is ephemeral UI, so this is a plain module ref (like
 * `clipDragPreviewRef`), not a store: cancelling never touches project truth
 * and never pushes an undo entry.
 */
export type TimelineGestureCanceler = () => boolean;

export const timelineGestureCancelerRef: { current: TimelineGestureCanceler | null } = { current: null };
