import { type AppliedLayerRecord } from '../../stores/adjustmentApplicationStore';

import { type CreateAdjustmentLayerApplierOutput } from './adjustmentLayerApplier';

type SharedAdjustmentLayerApplierSingleton = {
    inner: CreateAdjustmentLayerApplierOutput;
    userGainByTrack: Map<string, number>;
    userPanByTrack: Map<string, number>;
    gainOverridesByTrack: Map<string, Map<string, number>>;
    panOverridesByTrack: Map<string, Map<string, number>>;
    batchAppliedRecords: AppliedLayerRecord[];
    trackStoreUnsubscribe: () => void;
};

export const sharedAdjustmentLayerApplierState: {
    singleton: SharedAdjustmentLayerApplierSingleton | null;
} = {
    singleton: null,
};
