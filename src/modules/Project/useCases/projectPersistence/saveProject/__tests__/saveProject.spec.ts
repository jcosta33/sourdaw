import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../../__tests__/fakeIndexedDb';
import { saveProject } from '../saveProject';

import type { ProjectStoreState } from '../../../../stores/projectStore';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as ProjectStoreState | null },
    projectStoreSet: vi.fn<(value: ProjectStoreState) => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>(),
    addToRecentProjects: vi.fn<(name: string, key: string) => void>(),
    loggerWarn: vi.fn<(...args: unknown[]) => void>(),
    notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
    buildProjectData: vi.fn<() => Promise<{ data: unknown } | null>>(),
}));

vi.mock('../../fileIO/buildProjectData', () => ({
    buildProjectData: mocks.buildProjectData,
}));

vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('../../../recentProjects/addToRecentProjects', () => ({
    addToRecentProjects: mocks.addToRecentProjects,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

function makeProject(): ProjectStoreState {
    return {
        name: 'My Song',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        dirty: true,
        loading: false,
    } as unknown as ProjectStoreState;
}

describe('saveProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installFakeIndexedDb();
        mocks.projectStoreValue.value = makeProject();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.buildProjectData.mockResolvedValue({ data: { version: 1, meta: { name: 'My Song' } } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keys the recent-project entry by the stable project id, not the display name', async () => {
        saveProject();

        await vi.waitFor(() => {
            expect(mocks.addToRecentProjects).toHaveBeenCalledTimes(1);
        });
        const first_call = mocks.addToRecentProjects.mock.calls[0];
        if (!first_call) {
            throw new Error('expected an addToRecentProjects call');
        }
        const [, key] = first_call;
        // A rename changes name but not createdAt; the key must be stable across it.
        expect(key).toBe('sourdaw:project:1700000000000');
        expect(key).not.toContain('My Song');
    });

    it('does not record a recent-project entry when CRDT persistence rejects', async () => {
        mocks.persistCrdtProject.mockRejectedValue(new Error('disk full'));

        saveProject();

        await vi.waitFor(() => {
            expect(mocks.loggerWarn).toHaveBeenCalled();
        });
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
    });

    it('records a recent-project entry only after CRDT persistence succeeds', async () => {
        let resolvePersist: (() => void) | undefined;
        mocks.persistCrdtProject.mockReturnValue(
            new Promise<void>((resolve) => {
                resolvePersist = resolve;
            })
        );

        saveProject();

        // Not recorded synchronously before persistence settles.
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();

        resolvePersist?.();

        await vi.waitFor(() => {
            expect(mocks.addToRecentProjects).toHaveBeenCalledTimes(1);
        });
    });

    it('resolves true once persistence succeeds', async () => {
        await expect(saveProject()).resolves.toBe(true);
    });

    it('notifies and resolves false when persistence fails', async () => {
        const failure = new Error('idb write failed');
        mocks.persistCrdtProject.mockRejectedValue(failure);

        await expect(saveProject()).resolves.toBe(false);

        expect(mocks.loggerWarn).toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Save failed — your latest changes could not be persisted.',
            'error'
        );
        expect(mocks.addToRecentProjects).not.toHaveBeenCalled();
    });
});
