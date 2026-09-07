/**
 * Pull-model seam for durable audio ownership (issue #3777): the provider the
 * collectors call to fetch the buffer ids durably owned by saved named
 * projects and retained checkpoints/branches.
 *
 * Ownership is enumerated from the persisted project data at collection time
 * rather than recorded into a second registry, so it cannot drift from what
 * the projects actually reference: a deliberately deleted or superseded record
 * stops contributing its ids, and an id shared by several projects stays owned
 * while any one of them remains.
 *
 * AudioEngine must not import Project, so the composition root injects the
 * provider here. An unset provider means no durable ownership is knowable in
 * this process (fresh boot with no recents, tests) — the collectors treat the
 * owned set as empty and keep the plain age/budget rules. A provider that
 * rejects is an enumeration failure: the collectors abort the run and delete
 * nothing, because nothing can be proven unowned.
 */
export type DurableAudioBufferOwnershipProvider = () => Promise<readonly string[]>;

let provider: DurableAudioBufferOwnershipProvider | null = null;

export function setDurableAudioBufferOwnershipProvider(next: DurableAudioBufferOwnershipProvider | null): void {
    provider = next;
}

/** Resolves the durable owned-id set, or `null` when no provider is
 * registered. A provider rejection propagates to the caller. */
export function fetchDurableOwnedAudioBufferIds(): Promise<readonly string[]> | null {
    return provider?.() ?? null;
}
