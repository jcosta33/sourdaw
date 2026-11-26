import { adjustmentLayerStore } from '#/modules/Arrangement/stores';
import { modulationStore } from '#/modules/Automation/stores';

import { type OfflineRenderSessionSource } from './OfflineRenderSource';

/** The live session facts a render reads besides its document, not detached; see `captureOfflineRenderSessionSource`. */
export function readLiveOfflineRenderSessionModels(): OfflineRenderSessionSource {
    return {
        adjustmentLayers: adjustmentLayerStore.value?.layers ?? [],
        modulators: modulationStore.value?.modulators ?? [],
    };
}
