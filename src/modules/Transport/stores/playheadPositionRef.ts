/**
 * High-frequency playhead position channel.
 *
 * This is a plain mutable ref — NOT a reactive store. It is written to by
 * the playhead scheduler on every tick (~100×/sec) and read by rAF-driven
 * rendering loops (timeline, beat ruler, status bar). Because it bypasses
 * React's reconciler, reading it never triggers re-renders.
 *
 * For discrete / event-driven reads (recording, seek, commands), continue
 * using `transportStore.value.playheadPosition`, which is written on exactly
 * four events: `startPlayback`, `stopPlayback`, `pausePlayback`, and
 * `executePlayheadSeek`. Loop wrap is NOT one of them — the scheduler wraps
 * through this ref alone, so the store holds a stale beat for the whole of
 * playback. Anything the user reads during playback must follow this ref.
 */
export const playheadPositionRef = { current: 0 };
