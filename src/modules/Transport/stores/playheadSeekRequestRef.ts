/**
 * Ephemeral transport gesture authority for seeks that can wait on recording
 * teardown or runtime note panic. A later seek or pause retires the request;
 * scheduler generation separately retires it when Stop, Play or Record claims
 * a new transport session. This is not project truth or a UI store.
 */
export const playheadSeekRequestRef = { current: 0 };
