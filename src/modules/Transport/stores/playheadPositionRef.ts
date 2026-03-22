/**
 * High-frequency playhead position channel.
 *
 * This is a plain mutable ref — NOT a reactive store. It is written to by
 * the playhead scheduler on every tick (~100×/sec) and read by rAF-driven
 * rendering loops (timeline, beat ruler, status bar). Because it bypasses
 * React's reconciler, reading it never triggers re-renders.
 *
 * For discrete / event-driven reads (recording, seek, commands), continue
 * using `transportStore.value.playheadPosition` which is updated only on
 * discrete events (stop, seek, loop wrap).
 */
export const playheadPositionRef = { current: 0 };
