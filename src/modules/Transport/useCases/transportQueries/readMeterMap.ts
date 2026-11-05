import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';

/** The live meter map and the transport meter it falls back to before the first change. */
export function readMeterMap() {
    return {
        changes: timeSignatureMapStore.value?.changes ?? [],
        defaults: {
            defaultNumerator: transportStore.value?.timeSignatureNumerator ?? 4,
            defaultDenominator: transportStore.value?.timeSignatureDenominator ?? 4,
        },
    };
}
