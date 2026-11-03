/**
 * Scoped holds on runtime cache entries an operation has written, or is about
 * to write, and has not handed to an owner yet: a decoded stem awaiting its
 * agent run's registration, a finished take awaiting its commit, a buffer an
 * undo rehydrated for the replay about to place it. Nothing references such a
 * buffer yet, so without the hold the next burst of cache writes evicts it as
 * the least recently used unprotected entry.
 *
 * Retain each id before its cache write and release the hold in a `finally`
 * once the owner holds the id or the operation failed. Holds are counted, so
 * two operations retaining one id keep it until both release.
 */
export type AudioBufferResidencyHold = {
    readonly retain: (id: string) => void;
    readonly release: () => void;
};

const holdCountById = new Map<string, number>();

function releaseHeldId(id: string): void {
    const count = holdCountById.get(id) ?? 0;
    if (count <= 1) {
        holdCountById.delete(id);
        return;
    }
    holdCountById.set(id, count - 1);
}

export function openAudioBufferResidencyHold(): AudioBufferResidencyHold {
    const retainedIds = new Set<string>();
    let released = false;
    return {
        retain: (id) => {
            if (released) {
                throw new Error('An audio buffer residency hold cannot retain after its release.');
            }
            if (retainedIds.has(id)) {
                return;
            }
            retainedIds.add(id);
            holdCountById.set(id, (holdCountById.get(id) ?? 0) + 1);
        },
        release: () => {
            if (released) {
                return;
            }
            released = true;
            for (const id of retainedIds) {
                releaseHeldId(id);
            }
        },
    };
}

export function isAudioBufferHeld(id: string): boolean {
    return holdCountById.has(id);
}
