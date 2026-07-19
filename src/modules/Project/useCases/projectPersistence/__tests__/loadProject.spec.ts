import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: { loading: false, initialized: true } as ProjectStoreState },
    projectStoreSet: vi.fn(),
    createCrdtProject: vi.fn(),
    getCrdtDoc: vi.fn(() => ({ tracks: { tracks: [] } })),
    loadCrdtProject: vi.fn(),
    projectCrdtToStores: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    resetModuleStores: vi.fn(),
    stopActiveAutoSave: vi.fn(),
    setAutoSaveHandle: vi.fn(),
}));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: mocks.createCrdtProject,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({ migrateAbsoluteMidiNotes: vi.fn() }));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: mocks.resetModuleStores }));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mocks.stopActiveAutoSave }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mocks.setAutoSaveHandle }));

describe('loadProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        mocks.projectStoreValue.value = { loading: false, initialized: true } as ProjectStoreState;
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.createCrdtProject.mockResolvedValue(undefined);
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: vi.fn() });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it('should hydrate only after collaboration exits and persistence activates', async () => {
        await expect(loadProject()).resolves.toBe(true);

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(undoStore.value).toEqual({ past: [], future: [] });
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });

    it('should create a replacement document when persistence is empty', async () => {
        mocks.loadCrdtProject.mockResolvedValue(false);

        await expect(loadProject()).resolves.toBe(true);

        expect(createCrdtProject).toHaveBeenCalledWith('Untitled Project');
    });

    it('should preserve the current project when persistence loading fails', async () => {
        const failure = new Error('sanitization failed');
        mocks.loadCrdtProject.mockRejectedValue(failure);

        await expect(loadProject()).rejects.toBe(failure);

        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(projectStore.set).not.toHaveBeenCalled();
    });

    it('should ignore an older load that resolves after a newer load', async () => {
        let resolveFirst: ((loaded: boolean) => void) | undefined;
        let resolveSecond: ((loaded: boolean) => void) | undefined;
        mocks.loadCrdtProject
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveSecond = resolve;
                    })
            );

        const first = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(1));
        const second = loadProject();
        await vi.waitFor(() => expect(resetActionReplayAuthority).toHaveBeenCalledTimes(2));
        expect(loadCrdtProject).toHaveBeenCalledTimes(1);

        resolveFirst?.(true);
        await expect(first).resolves.toBe(false);
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(2));
        resolveSecond?.(true);
        await expect(second).resolves.toBe(true);

        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });

    it('should abort before repository load when collaboration shutdown fails', async () => {
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.reject(new Error('shutdown failed')),
        });

        await expect(loadProject()).resolves.toBe(false);

        expect(loadCrdtProject).not.toHaveBeenCalled();
        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
    });

    it('waits for an in-flight action before CRDT identity publication and clears its history', async () => {
        type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
        let mark_action_started!: () => void;
        let release_action!: () => void;
        const action_started = new Promise<void>((resolve) => {
            mark_action_started = resolve;
        });
        const action_gate = new Promise<void>((resolve) => {
            release_action = resolve;
        });
        const handler: ActionHandler<SetSnapValueAction> = {
            undoable: true,
            describe: () => ({ label: 'Deferred edit', inverseAction: { type: 'togglePlayback' } }),
            execute: async () => {
                mark_action_started();
                await action_gate;
            },
        };
        registerHandlerMap({ setSnapValue: handler });

        const action = executeAppAction({ type: 'setSnapValue', payload: { value: 0.5 } });
        await action_started;
        const transition = loadProject();
        await Promise.resolve();
        await Promise.resolve();

        expect(loadCrdtProject).not.toHaveBeenCalled();

        release_action();
        await expect(action).resolves.toBeUndefined();
        await expect(transition).resolves.toBe(true);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });
});
