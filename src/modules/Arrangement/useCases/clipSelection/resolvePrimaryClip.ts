// The primary clip is the one single-clip commands act on. It is always a member of the
// selection, and a selection of exactly one clip always has that clip as its primary. A
// larger selection may have no primary, which means no clip is focused.
export function resolvePrimaryClip(selectedClipIds: readonly string[], preferredPrimary: string | null): string | null {
    if (selectedClipIds.length === 1) {
        return selectedClipIds[0] ?? null;
    }
    if (preferredPrimary !== null && selectedClipIds.includes(preferredPrimary)) {
        return preferredPrimary;
    }
    return null;
}
