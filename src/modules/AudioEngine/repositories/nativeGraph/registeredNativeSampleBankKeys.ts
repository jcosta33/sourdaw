/**
 * What this process believes the native sample bank store already holds
 * (#3124).
 *
 * Module state, and deliberately process-wide for the same reason
 * {@link registeredNativeTimelineSampleIds} is: the store is the native
 * process's, keyed by bank key with replace semantics, and it outlives every
 * session. A per-session memo would re-decode and re-push a whole orchestral
 * instrument — hundreds of megabytes of PCM — at every play gesture, with the
 * musician waiting for the first frame.
 *
 * It sits in its own file so that `registerNativeSampleBanks`, which adds to
 * it, is not also the only way to reach it: a test whose module registry is
 * shared across files would otherwise inherit a previous case's belief about a
 * store its own transport never saw, and clears it here instead.
 *
 * A key belongs here only once `commit_levain_bank` has answered. A staging
 * step that failed leaves the key unknown, so the next batch stages it again
 * rather than sending a device the mapper will refuse — and meanwhile the
 * mapper refuses that device by name instead of splicing a mute sampler.
 */

export const registeredNativeSampleBankKeys = new Set<string>();
