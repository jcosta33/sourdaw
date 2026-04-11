import { adjustmentLayerStore } from '#/modules/Arrangement/stores/adjustmentLayer';

export function getLayerCount(): number {
    return adjustmentLayerStore.value?.layers.length ?? 0;
}
