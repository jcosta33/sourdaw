/**
 * How many loop wraps the published playhead has performed since this
 * playback roll began — the traversal fact a backwards event-time integration
 * needs to bound itself by what the roll actually travelled (#4668, #4875).
 *
 * Written by the playhead scheduler at the only moments the published cursor
 * wraps: a late-wrap tick (the wrapped position commits and publishes in the
 * same tick) and the tick whose pending seam instant arrives (the published
 * clock pivots to the incoming pass). `startPlayheadScheduler` resets it to
 * zero beside the clock anchor it republishes, so the count and the store's
 * `playheadPosition` — the rolling epoch a capture inverts from — always
 * describe the same roll.
 *
 * This is deliberately not `schedulerSession.discontinuityEpoch`: that epoch
 * also advances on session starts, follow-action jumps, and one look-ahead
 * before the seam while the published clock still shows the dying pass, so a
 * difference of it is not a wrap count. The engine's own wrap count is not it
 * either: the engine reports wraps since the engine started, and only while
 * the engine is the audible transport. This ref counts the wraps of the very
 * cursor `captureGestureBeat` answers from, whatever carried it.
 *
 * A plain mutable ref, same contract as `playheadPositionRef`: written by the
 * scheduler, read on the gesture/event path, never by React.
 */
export const playheadWrapCountRef = { current: 0 };
