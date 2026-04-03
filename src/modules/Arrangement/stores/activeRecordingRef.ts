/** Ephemeral ref tracking clips that are actively being recorded.
 * Read by buildTimelineRenderModel to render the clip growing in real-time
 * by using the current playhead position as the live endBeat. */
export const activeRecordingRef: { current: string[] } = { current: [] };
