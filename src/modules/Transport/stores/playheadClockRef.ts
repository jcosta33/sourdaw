/**
 * The scheduler's committed clock anchor: the playback position together with
 * the AudioContext instant that position was projected to.
 *
 * Written by the playhead scheduler exactly where it commits
 * `schedulerSession.accumulatedPosition` — at session start, once per completed
 * tick, and reset on teardown. `captureGestureBeat` projects this pair forward
 * over the audio clock to timestamp an event, which is why the two numbers must
 * be published together: a beat alone cannot be integrated against later audio
 * time, and the rAF-oriented `playheadPositionRef` (a latest-value channel
 * published after a tick's awaited work) is not an event-time anchor.
 *
 * A plain mutable holder, not a store: same contract as `playheadPositionRef`,
 * read on the gesture/event path rather than by React.
 */
export const playheadClockRef = {
    /** Playback position in beats, as committed by the last completed tick. */
    beat: 0,
    /** The AudioContext.currentTime that `beat` is the position for. */
    audioTimeSeconds: 0,
};
