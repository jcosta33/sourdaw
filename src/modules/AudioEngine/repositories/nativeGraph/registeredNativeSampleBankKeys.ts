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
 * rather than sending a device the mapper will refuse — and meanwhile
 * `map_device` answers `Err` for that device by name instead of splicing a mute
 * sampler, which on an audible strip refuses the batch whole and declines the
 * session with the bank in its reason.
 */

export const registeredNativeSampleBankKeys = new Set<string>();

/**
 * The bank keys a call has staged but not yet committed, and the shipment to
 * await for each.
 *
 * Beside the set rather than inside `registerNativeSampleBanks` for the same
 * reason and under the same clearing rule: the live backend and the offline
 * render both stage into this one process-wide store, from queues that do not
 * know about each other, so two callers can reach one key at once. The set only
 * answers for keys already committed, which is too late — `begin_levain_bank`
 * replaces whatever entry the store holds for a key, so a second `begin`
 * arriving mid-shipment discards the first one's samples and the commit that
 * follows describes a bank that is no longer there. A caller that finds a
 * shipment in flight therefore waits for it instead of starting a second.
 *
 * A test that clears the set clears this too: a lingering entry would make the
 * next case await a promise its own transport never made.
 */
export const inFlightNativeSampleBankShipments = new Map<string, Promise<void>>();
