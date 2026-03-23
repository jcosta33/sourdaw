import { adjustmentLayerStore } from '#/modules/Clip/stores/adjustmentLayer';

export function getLayerCount(): number {
    return adjustmentLayerStore.value?.layers.length ?? 0;
}
