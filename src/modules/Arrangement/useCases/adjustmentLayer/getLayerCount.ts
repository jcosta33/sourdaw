import { inject } from '#/infra/di/inject';
import { adjustmentLayerStore } from '#/modules/Arrangement/stores/adjustmentLayer';

export const getLayerCount = inject({ adjustmentLayerStore })(
    ({ adjustmentLayerStore: layerStore }) =>
        function getLayerCount(): number {
            return layerStore.value?.layers.length ?? 0;
        }
);
