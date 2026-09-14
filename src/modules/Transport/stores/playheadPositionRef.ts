/**
 * High-frequency playhead position channel.
 *
 * This is a plain mutable ref — NOT a reactive store. It is written to by
 * the playhead scheduler on every tick (~100×/sec) and read by rAF-driven
 * rendering loops (timeline, beat ruler, status bar). Because it bypasses
 * React's reconciler, reading it never triggers re-renders.
 *
 * It is a latest-value channel, not an event-time clock: a tick samples the
 * audio clock, advances its position, can await scheduling work, and only then
 * publishes here. An event timestamped from this ref gets whichever later beat
 * happened to be visible when its handler ran.
 *
 * Event-time capture therefore does NOT read this ref. Timestamping a gesture
 * against the moving transport goes through `captureGestureBeat`
 * (Transport/stores), which projects the scheduler's committed
 * `playheadClockRef` anchor over the audio clock and prefers the native
 * engine's cursor while that engine is the audible transport (#3799).
 *
 * For state read *between* playback sessions, use `transportStore.value.playheadPosition`,
 * which is written on exactly four events: `startPlayback`, `stopPlayback`,
 * `pausePlayback`, and `executePlayheadSeek`. Loop wrap is NOT one of them — the
 * scheduler wraps through this ref alone, so the store holds a stale beat for
 * the whole of playback.
 */
export const playheadPositionRef = { current: 0 };
