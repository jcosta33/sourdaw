/**
 * Ephemeral transport gesture authority for seeks that can wait on recording
 * teardown or runtime note panic. A later seek, Pause or Record gesture retires
 * the request, including a count-in before its scheduler starts. Scheduler
 * generation separately retires it when a new transport session is claimed.
 * This is not project truth or a UI store.
 */
export const playheadSeekRequestRef = { current: 0 };
