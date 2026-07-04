import { projectStore, type ProjectStoreState } from '#/modules/Project/stores';

import { defaultStepRecordState, stepRecordStore, type StepRecordState } from '../../../stores/stepRecordStore';

const originalProjectState = projectStore.value;

export function makeStepRecordState(overrides: Partial<StepRecordState> = {}): StepRecordState {
    return {
        ...defaultStepRecordState,
        activeNotes: new Set<number>(),
        ...overrides,
    };
}

export function makeProjectState(overrides: Partial<ProjectStoreState> = {}): ProjectStoreState {
    const source = projectStore.value ?? originalProjectState;
    if (!source) {
        throw new Error('Expected projectStore to have an initial state');
    }

    return {
        ...source,
        tuning: {
            ...source.tuning,
            frequencies: [...source.tuning.frequencies],
        },
        ...overrides,
    };
}

export function resetStepRecordNavigationStores(): void {
    stepRecordStore.set(makeStepRecordState());
    projectStore.set(originalProjectState);
}
