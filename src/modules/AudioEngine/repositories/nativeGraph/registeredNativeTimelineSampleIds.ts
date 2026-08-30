/**
 * What this process believes the native timeline sample pool already holds
 * (#3068).
 *
 * Module state, and deliberately process-wide: the pool is the native
 * process's, keyed by identity with replace semantics, and it outlives every
 * session. A per-session memo would re-push a project's whole decoded PCM on
 * every play — tens of megabytes at the gesture, with the musician waiting for
 * the first frame, which is exactly the cost `createNativeLiveGraphBackend`'s
 * header says must never be paid there.
 *
 * It sits in its own file so that `registerNativeTimelineSamples`, which adds
 * to it, is not also the only way to reach it: a test whose module registry is
 * shared across files would otherwise inherit a previous case's belief about a
 * pool its own transport never saw, and clears it here instead.
 *
 * An id belongs here only once the bridge has confirmed it. A failed
 * registration leaves the id unknown, so the next caller — the play gesture, if
 * nothing else — tries again rather than scheduling against a sample that never
 * landed.
 */

export const registeredNativeTimelineSampleIds = new Set<string>();
