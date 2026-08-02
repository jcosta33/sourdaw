type CompareProjectSnapshotsInput = {
    /** The IndexedDB copy — the only store this build writes project content to. */
    primary: string;
    /** A pre-ADR-0013 localStorage copy that has not been migrated away yet. */
    mirror: string;
};

type CompareProjectSnapshotsOutput = {
    /**
     * `'indeterminate'` means exactly that: at least one copy carries no
     * readable `meta.updatedAt`, so neither can be shown to supersede the
     * other. It is deliberately not folded into a winner — a caller that
     * *deletes* must be able to tell "a newer copy is confirmed to exist" from
     * "a value exists here and is not provably older". Collapsing those two is
     * presence preference wearing a recency costume, and it is the defect this
     * module exists to remove.
     */
    verdict: 'primary-newer-or-equal' | 'mirror-newer' | 'indeterminate';
    primaryReadable: boolean;
    mirrorReadable: boolean;
};

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
 * Compare two copies of the same project key by their stamped `meta.updatedAt`,
 * reporting which copies were interpretable at all.
 *
 * `buildProjectData` always stamps `updatedAt`, so an unreadable copy is
 * corrupt, truncated, or not written by this application. Callers decide what
 * that means for them: a read falls back to the store of record, while the
 * migration refuses to delete anything it cannot account for.
 *
 * This exists only for the migration window. Once
 * `migrateLegacyProjectSnapshots` has drained the mirrors there is one copy and
 * nothing to resolve.
 */
export function compareProjectSnapshots({
    primary,
    mirror,
}: CompareProjectSnapshotsInput): CompareProjectSnapshotsOutput {
    const primaryUpdatedAt = readUpdatedAt(primary);
    const mirrorUpdatedAt = readUpdatedAt(mirror);
    const primaryReadable = primaryUpdatedAt !== null;
    const mirrorReadable = mirrorUpdatedAt !== null;

    if (primaryUpdatedAt === null || mirrorUpdatedAt === null) {
        return { verdict: 'indeterminate', primaryReadable, mirrorReadable };
    }
    if (mirrorUpdatedAt > primaryUpdatedAt) {
        return { verdict: 'mirror-newer', primaryReadable, mirrorReadable };
    }
    return { verdict: 'primary-newer-or-equal', primaryReadable, mirrorReadable };
}
