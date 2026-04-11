import { mixAnalysisStore } from '../../stores/mixAnalysisStore';

/** Get the mix analysis store value. */
export function getMixAnalysisStoreValue(): typeof mixAnalysisStore.value {
    return mixAnalysisStore.value;
}