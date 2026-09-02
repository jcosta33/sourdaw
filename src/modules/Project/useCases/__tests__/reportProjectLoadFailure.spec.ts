import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { reportProjectLoadFailure } from '../reportProjectLoadFailure';

const mocks = vi.hoisted(() => {
    let projectValue: ProjectStoreState | null = null;
    let failureValue: { message: string; projectName: string } | null = null;

    return {
        projectLoadFailureStore: {
            get value() {
                return failureValue;
            },
            set: vi.fn((nextValue: { message: string; projectName: string } | null) => {
                failureValue = nextValue;
            }),
        },
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

vi.mock('../../stores/projectLoadFailureStore', () => ({
    projectLoadFailureStore: mocks.projectLoadFailureStore,
}));

vi.mock('../../stores/projectStore', () => ({
    projectStore: mocks.projectStore,
}));

function createProjectState(overrides: Partial<ProjectStoreState> = {}): ProjectStoreState {
    return {
        name: 'Untitled Project',
        createdAt: 1,
        updatedAt: 2,
        dirty: false,
        loading: true,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: [440],
        },
        initialized: false,
        ...overrides,
        productionBrief: overrides.productionBrief ?? createDefaultProductionBrief(1),
    };
}

describe('reportProjectLoadFailure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStore.value = null;
        mocks.projectLoadFailureStore.set(null);
        mocks.projectLoadFailureStore.set.mockClear();
    });

    it('publishes the failure surface and clears loading on the current project', () => {
        const initialProject = createProjectState({ name: 'Untitled Project', loading: true });
        mocks.projectStore.value = initialProject;

        reportProjectLoadFailure({
            message: 'App failed to load — please reload the page.',
            projectName: 'Untitled Project',
        });

        expect(mocks.projectLoadFailureStore.set).toHaveBeenCalledWith({
            message: 'App failed to load — please reload the page.',
            projectName: 'Untitled Project',
        });
        expect(mocks.projectStore.set).toHaveBeenCalledWith({
            ...initialProject,
            loading: false,
        });
    });

    it('still publishes the failure surface when no project is loaded', () => {
        reportProjectLoadFailure({
            message: 'App failed to load — please reload the page.',
            projectName: 'Untitled Project',
        });

        expect(mocks.projectLoadFailureStore.set).toHaveBeenCalledWith({
            message: 'App failed to load — please reload the page.',
            projectName: 'Untitled Project',
        });
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
    });
});
