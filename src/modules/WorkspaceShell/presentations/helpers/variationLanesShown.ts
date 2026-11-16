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
