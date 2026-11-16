type VariationLanesShown = ReadonlyMap<string, boolean>;

export const isSameVariationLanesShown = (a: VariationLanesShown, b: VariationLanesShown): boolean => {
    if (a.size !== b.size) {
        return false;
    }
    for (const [trackId, shown] of a) {
        if (b.get(trackId) !== shown) {
            return false;
        }
    }
    return true;
};

/** Tracks that were present with variation lanes off in `previous` and have them on in `current`. */
export const findEnabledVariationLaneTrackIds = (
    previous: VariationLanesShown | null,
    current: VariationLanesShown
): string[] => {
    if (previous === null) {
        return [];
    }
    const enabledTrackIds: string[] = [];
    for (const [trackId, shown] of current) {
        if (shown && previous.get(trackId) === false) {
            enabledTrackIds.push(trackId);
        }
    }
    return enabledTrackIds;
};
