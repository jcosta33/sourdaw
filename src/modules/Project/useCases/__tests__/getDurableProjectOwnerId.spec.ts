import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { getDurableProjectOwnerId } from '../getDurableProjectOwnerId';

const CANONICAL_PROJECT_ID = '405e744b-dead-843a-9395-86fdcd66368c';

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
        },
    };
});

vi.mock('../../stores/projectStore', () => ({
    projectStore: mocks.projectStore,
}));

function createProjectState(overrides: Partial<ProjectStoreState> = {}): ProjectStoreState {
    return {
        projectId: CANONICAL_PROJECT_ID,
        name: 'Session',
        createdAt: 1,
        updatedAt: 2,
        dirty: false,
        loading: false,
        identityMigrationPending: false,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: [440],
        },
        initialized: true,
        productionBrief: createDefaultProductionBrief(1),
        ...overrides,
    };
}

describe('getDurableProjectOwnerId', () => {
    beforeEach(() => {
        mocks.projectStore.value = null;
    });

    it('returns the canonical settled project identity unchanged', () => {
        mocks.projectStore.value = createProjectState();

        expect(getDurableProjectOwnerId()).toBe(CANONICAL_PROJECT_ID);
    });

    it.each([
        ['no project is composed', null],
        ['the session is uninitialized', createProjectState({ initialized: false })],
        ['the project ID is absent', createProjectState({ projectId: undefined })],
        ['the project ID is malformed', createProjectState({ projectId: 'not-a-project-uuid' })],
        ['identity migration is pending', createProjectState({ identityMigrationPending: true })],
    ])('returns no owner when %s', (_scenario, project) => {
        mocks.projectStore.value = project;

        expect(getDurableProjectOwnerId()).toBeUndefined();
    });
});
