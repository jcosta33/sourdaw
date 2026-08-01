type PickNewerProjectSnapshotInput = {
    /** The IndexedDB copy — the only store this build writes project content to. */
    primary: string;
    /** A pre-ADR-0013 localStorage copy that has not been migrated away yet. */
    mirror: string;
};

type PickNewerProjectSnapshotOutput = 'primary' | 'mirror';

function readUpdatedAt(json: string): number | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }

    if (typeof parsed !== 'object' || parsed === null || !('meta' in parsed)) {
        return null;
    }
    const meta: unknown = parsed.meta;
    if (typeof meta !== 'object' || meta === null || !('updatedAt' in meta)) {
        return null;
    }
    const updatedAt: unknown = meta.updatedAt;
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        return null;
    }
    return updatedAt;
}

/**
 * Decide which of two copies of the same project key is current.
 *
 * The rule, stated so it cannot be mistaken for "whichever copy is present"
 * (ADR 0013, and the defect it retires): **the mirror wins only when both
 * copies carry a readable `meta.updatedAt` and the mirror's is strictly
 * greater.** Every other case — equal timestamps, either timestamp missing or
 * unparseable — resolves to the primary, because IndexedDB is the only store
 * this build writes to and is therefore never behind unless a legacy mirror can
 * prove otherwise.
 *
 * This exists only for the migration window. Once
 * `migrateLegacyProjectSnapshots` has drained the mirrors there is one copy and
 * nothing to resolve.
 */
export function pickNewerProjectSnapshot({
    primary,
    mirror,
}: PickNewerProjectSnapshotInput): PickNewerProjectSnapshotOutput {
    const primaryUpdatedAt = readUpdatedAt(primary);
    const mirrorUpdatedAt = readUpdatedAt(mirror);

    if (primaryUpdatedAt === null || mirrorUpdatedAt === null) {
        return 'primary';
    }
    if (mirrorUpdatedAt > primaryUpdatedAt) {
        return 'mirror';
    }
    return 'primary';
}
