import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function moveAdjustmentRegion(regionId: string, startBeat: number, endBeat: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
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
