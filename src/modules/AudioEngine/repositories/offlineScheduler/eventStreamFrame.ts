/**
 * One compiled event time (or any other duration on a compiled stream's
 * clock — a scope-window bound, plus a compensation shift if the caller's is
 * shifted) in the frames the segment schedule addresses: clamped to the
 * render and rounded once.
 *
 * Shared so a scope-window bound and the events inside it land on the same
 * frame grid: `compiledEventsToSegments` converts every event through this
 * function, and the scope-window arithmetic at the `automationScheduling`
 * collection site and in `mergeAutomationEventStreams` runs the window's end
 * through the same one.
 */
export function eventStreamFrame(seconds: number, durationSeconds: number, sampleRate: number): number {
    return Math.round(Math.min(durationSeconds, Math.max(0, seconds)) * sampleRate);
}
