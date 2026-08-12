import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { setProjectScaleName } from '../setProjectScaleName';

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

describe('setProjectScaleName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStore.value = null;
    });

    it('should not create project state when no project is loaded', () => {
        setProjectScaleName('minor');

        expect(mocks.projectStore.set).not.toHaveBeenCalled();
    });

    it('should set a known scale name and preserve the rest of the project', () => {
        const initialProject = createProjectState();
        mocks.projectStore.value = initialProject;

        setProjectScaleName('dorian');

        expect(mocks.projectStore.set).toHaveBeenCalledWith({
            ...initialProject,
            scaleName: 'dorian',
        });
    });

    it('should not write unknown scale names', () => {
        const invalidScaleNames = ['', 'ionian', 'toString'];

        for (const invalidScaleName of invalidScaleNames) {
            mocks.projectStore.value = createProjectState();
            mocks.projectStore.set.mockClear();

            setProjectScaleName(invalidScaleName);

            expect(mocks.projectStore.set).not.toHaveBeenCalled();
        }
    });
});
