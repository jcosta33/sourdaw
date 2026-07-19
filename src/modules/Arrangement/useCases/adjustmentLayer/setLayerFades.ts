import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function setLayerFades(regionId: string, fadeInBeats: number, fadeOutBeats: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    const matching_layers = state.layers.filter((layer) => layer.regions.some((region) => region.id === regionId));
    if (matching_layers.length > 1) {
        throw new Error(`Ambiguous adjustment region id: ${regionId}`);
    }

    const safeFadeIn = Math.max(0, fadeInBeats);
    const safeFadeOut = Math.max(0, fadeOutBeats);

    adjustmentLayerStore.set({
        layers: state.layers.map((l) => {
            if (!l.regions.some((r) => r.id === regionId)) {
                return l;
            }
            return {
                ...l,
                regions: l.regions.map((r) =>
                    r.id === regionId ? { ...r, fadeInBeats: safeFadeIn, fadeOutBeats: safeFadeOut } : r
                ),
            };
        }),
    });
}
