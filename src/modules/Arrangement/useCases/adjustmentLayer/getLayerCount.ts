import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function getLayerCount(): number {
    return adjustmentLayerStore.value?.layers.length ?? 0;
}
