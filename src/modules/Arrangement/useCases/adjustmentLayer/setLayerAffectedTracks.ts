import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function setLayerAffectedTracks(layerId: string, trackIds: string[]): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }

    const deduped = Array.from(new Set(trackIds));

    adjustmentLayerStore.set({
        layers: state.layers.map((l) => (l.id === layerId ? { ...l, affectedTrackIds: deduped } : l)),
    });
}
