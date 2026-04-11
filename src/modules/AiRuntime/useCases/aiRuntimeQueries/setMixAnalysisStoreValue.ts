import { mixAnalysisStore } from '../../stores/mixAnalysisStore';

export type MixAnalysisState = NonNullable<typeof mixAnalysisStore.value>;

/** Set the mix analysis store value. */
export function setMixAnalysisStoreValue(state: MixAnalysisState): void {
    mixAnalysisStore.set(state);
}