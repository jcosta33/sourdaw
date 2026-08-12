import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { setProjectKeyRoot } from '../setProjectKeyRoot';

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

function createProjectState(): ProjectStoreState {
    return {
        name: 'Session',
        createdAt: 1,
        updatedAt: 2,
        dirty: false,
        loading: false,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: [440],
        },
        initialized: true,
        productionBrief: createDefaultProductionBrief(1),
    };
}

describe('setProjectKeyRoot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStore.value = null;
    });

    it('should not create project state when no project is loaded', () => {
        setProjectKeyRoot(7);

        expect(mocks.projectStore.set).not.toHaveBeenCalled();
    });

    it('should set integer pitch classes and preserve the rest of the project', () => {
        const validRoots = [0, 7, 11];

        for (const validRoot of validRoots) {
            const initialProject = createProjectState();
            mocks.projectStore.value = initialProject;
            mocks.projectStore.set.mockClear();

            setProjectKeyRoot(validRoot);

            expect(mocks.projectStore.set).toHaveBeenCalledWith({
                ...initialProject,
                keyRoot: validRoot,
            });
        }
    });

    it('should not write invalid pitch classes', () => {
        const invalidRoots = [-1, 12, 2.5, Number.NaN, Number.POSITIVE_INFINITY];

        for (const invalidRoot of invalidRoots) {
            mocks.projectStore.value = createProjectState();
            mocks.projectStore.set.mockClear();

            setProjectKeyRoot(invalidRoot);

            expect(mocks.projectStore.set).not.toHaveBeenCalled();
        }
    });
});
