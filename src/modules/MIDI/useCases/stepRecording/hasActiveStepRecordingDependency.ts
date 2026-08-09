import { stepRecordStore } from '../../stores/stepRecordStore';

export function hasActiveStepRecordingDependency(clipIds: readonly string[]): boolean {
    const state = stepRecordStore.value;
    return state?.active === true && state.clipId !== null && clipIds.includes(state.clipId);
}
