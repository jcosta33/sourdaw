import { adjustmentApplicationStore } from '../../../stores/adjustmentApplicationStore';
import { sharedAdjustmentLayerApplierState } from '../sharedAdjustmentLayerApplierState';

export function resetSharedAdjustmentLayerApplierForTest(): void {
    if (sharedAdjustmentLayerApplierState.singleton) {
        sharedAdjustmentLayerApplierState.singleton.trackStoreUnsubscribe();
    }
    sharedAdjustmentLayerApplierState.singleton = null;
    adjustmentApplicationStore.set({ applied: [] });
}
