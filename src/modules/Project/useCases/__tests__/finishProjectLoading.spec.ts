import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { finishProjectLoading } from '../finishProjectLoading';

const mocks = vi.hoisted(() => {
    let projectValue: ProjectStoreState | null = null;

    return {
        projectStore: {
            get value(): ProjectStoreState | null {
                return projectValue;
            },
            set value(nextValue: ProjectStoreState | null) {
                projectValue = nextValue;
            },
            set: vi.fn<(nextValue: ProjectStoreState) => void>(),
        },
    };
});

vi.mock('../../stores/projectStore', () => ({
    projectStore: mocks.projectStore,
}));

function createProjectState(overrides: Partial<ProjectStoreState> = {}): ProjectStoreState {
    return {
        name: 'Session',
        createdAt: 1,
        updatedAt: 2,
        dirty: true,
        loading: true,
        keyRoot: 7,
        scaleName: 'dorian',
        tuning: {
            name: 'Equal Temperament',
            frequencies: [440],
        },
        initialized: true,
        ...overrides,
        productionBrief: overrides.productionBrief ?? createDefaultProductionBrief(1),
    };
}

describe('finishProjectLoading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStore.value = null;
    });

    it('should not create project state when no project is loaded', () => {
        finishProjectLoading();

        expect(mocks.projectStore.set).not.toHaveBeenCalled();
    });

    it('should clear loading and preserve every other project field', () => {
        for (const initialized of [false, true]) {
            const initialProject = createProjectState({ initialized });
            mocks.projectStore.value = initialProject;
            mocks.projectStore.set.mockClear();

            finishProjectLoading();

            expect(mocks.projectStore.set).toHaveBeenCalledWith({
                ...initialProject,
                loading: false,
                initialized,
            });
        }
    });
});
