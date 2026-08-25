/**
 * Ephemeral registry of the currently mounted timeline gesture cancelers.
 * `useTimelineInteractions` and `BeatRulerBar` keep their cancelers
 * registered while mounted; the global Escape path (CommandInterface
 * `handleKeydown`) invokes them through `cancelActiveTimelineGesture`.
 *
 * Gesture state is ephemeral UI, so this is a plain module ref (like
 * `clipDragPreviewRef`), not a store: cancelling never touches project truth
 * and never pushes an undo entry.
 */
export type TimelineGestureCanceler = () => boolean;

export const timelineGestureCancelerRef: { current: Set<TimelineGestureCanceler> } = { current: new Set() };
