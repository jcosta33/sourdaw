import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function moveAdjustmentRegion(regionId: string, startBeat: number, endBeat: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    const matching_layers = state.layers.filter((layer) => layer.regions.some((region) => region.id === regionId));
    if (matching_layers.length > 1) {
        throw new Error(`Ambiguous adjustment region id: ${regionId}`);
    }

    const clampedStart = Math.max(0, Math.min(startBeat, endBeat));
    const clampedEnd = Math.max(clampedStart, endBeat);

    adjustmentLayerStore.set({
        layers: state.layers.map((l) => {
            if (!l.regions.some((r) => r.id === regionId)) {
                return l;
            }
            return {
                ...l,
                regions: l.regions
                    .map((r) => (r.id === regionId ? { ...r, startBeat: clampedStart, endBeat: clampedEnd } : r))
                    .sort((a, b) => a.startBeat - b.startBeat),
            };
        }),
    });
}
