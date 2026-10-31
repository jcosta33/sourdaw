export function isDerivedSourceSupportPath(operation: string | undefined, path: string): boolean {
    if (operation === 'editTempoMap' || operation === 'restoreTempoMapEdit') {
        return (
            path === 'rowPlan' ||
            path.startsWith('rowPlan.') ||
            path === 'audioSourcePromotion' ||
            path.startsWith('audioSourcePromotion.')
        );
    }
    if (operation === 'setTempo' || operation === 'restoreTempoEdit') {
        return path === 'audioSourcePromotion' || path.startsWith('audioSourcePromotion.');
    }
    if (
        operation !== 'setCompRegion' &&
        operation !== 'removeCompRegion' &&
        operation !== 'restoreCompRegionInterval'
    ) {
        return false;
    }
    return (
        path.startsWith('audioSourcePromotions[') || /^(expected|replacement)\[\d+\]\.audioSource(?:\.|$)/.test(path)
    );
}
