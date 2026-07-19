import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { createCrdtProject, projectActionHistoryToStore, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { removeProjectJson } from '../../../repositories/project/removeProjectJson';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { newProject } from '../newProject';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });

    return { promise, resolve: resolveDeferred };
}

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearCachedAudioBuffers: vi.fn(),
    resetAudioGraph: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: vi.fn().mockResolvedValue(undefined),
    projectActionHistoryToStore: vi.fn(),
    startCrdtAutoSave: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));

vi.mock('../helpers/runProjectLoadTransaction', () => ({
    runProjectLoadTransaction: vi.fn(() => ({
        prepare: vi.fn(() => Promise.resolve(true)),
        activate: vi.fn(() => true),
        canActivate: () => true,
        isCurrent: () => true,
    })),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addTrack: vi.fn(),
    cancelFreezeTasksForProjectTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../repositories/project/removeProjectJson', () => ({
    removeProjectJson: vi.fn(),
}));

describe('newProject injectable', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            name: 'Existing Project',
            loading: false,
            initialized: true,
        });
    });

    it('should forward to injected collaborators in fresh-project order', async () => {
        const activated = await newProject('Test');

        expect(activated).toBe(true);
        expect(runProjectLoadTransaction).toHaveBeenCalledTimes(1);
        const { cancelFreezeTasksForProjectTransition } = await import('#/modules/Arrangement/useCases');
        expect(cancelFreezeTasksForProjectTransition).toHaveBeenCalledOnce();
        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(resetAudioGraph).toHaveBeenCalledTimes(1);
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(createCrdtProject).toHaveBeenCalledWith('Test');
        expect(projectActionHistoryToStore).toHaveBeenCalledTimes(1);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Master', kind: 'master', select: false });
        expect(removeProjectJson).toHaveBeenCalledTimes(1);
        expect(clearCachedAudioBuffers).toHaveBeenCalledTimes(1);
        expect(undoStore.value).toEqual({ past: [], future: [] });
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);

        const cancel_freeze_order = vi.mocked(cancelFreezeTasksForProjectTransition).mock.invocationCallOrder[0];
        const create_project_order = vi.mocked(createCrdtProject).mock.invocationCallOrder[0];
        expect(cancel_freeze_order).toBeLessThan(create_project_order!);

        const remove_project_json_order = vi.mocked(removeProjectJson).mock.invocationCallOrder[0];
        const clear_audio_buffers_order = vi.mocked(clearCachedAudioBuffers).mock.invocationCallOrder[0];
        if (remove_project_json_order === undefined || clear_audio_buffers_order === undefined) {
            throw new Error('expected removeProjectJson and clearCachedAudioBuffers calls');
        }

        expect(clear_audio_buffers_order).toBeGreaterThan(remove_project_json_order);
    });

    it('clears loading when the current activation fails', async () => {
        vi.mocked(createCrdtProject).mockRejectedValueOnce(new Error('CRDT setup failed'));

        const activated = await newProject('Broken Project');

        expect(activated).toBe(false);
        expect(projectStore.value).toMatchObject({
            name: 'Existing Project',
            loading: false,
            initialized: true,
        });
    });

    it('reports a committed project truthfully when post-commit projection is degraded', async () => {
        vi.mocked(projectActionHistoryToStore).mockImplementationOnce(() => {
            throw new Error('projection failed');
        });

        await expect(newProject('Committed Project')).resolves.toBe(true);

        expect(createCrdtProject).toHaveBeenCalledWith('Committed Project');
        expect(resetModuleStoresToDefault).toHaveBeenCalledOnce();
        expect(addTrack).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('does not clear loading when an older activation is superseded', async () => {
        const playbackStop = createDeferred<void>();
        let isCurrent = true;
        vi.mocked(runProjectLoadTransaction).mockReturnValueOnce({
            prepare: vi.fn().mockResolvedValue(true),
            activate: vi.fn().mockReturnValue(true),
            canActivate: () => isCurrent,
            isCurrent: () => isCurrent,
        });
        vi.mocked(stopPlayback).mockReturnValueOnce(playbackStop.promise);

        const activation = newProject('Older Project');
        await vi.waitFor(() => expect(stopPlayback).toHaveBeenCalledTimes(1));

        isCurrent = false;
        const newerLoadingState = {
            ...projectStore.value!,
            name: 'Newer Project',
            loading: true,
            initialized: false,
        };
        projectStore.set(newerLoadingState);
        playbackStop.resolve(undefined);

        await expect(activation).resolves.toBe(false);
        expect(projectStore.value).toBe(newerLoadingState);
    });

    it('waits for an in-flight action before publishing the new identity and clears its history', async () => {
        type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
        const action_started = createDeferred<void>();
        const action_release = createDeferred<void>();
        const handler: ActionHandler<SetSnapValueAction> = {
            undoable: true,
            describe: () => ({ label: 'Deferred edit', inverseAction: { type: 'togglePlayback' } }),
            execute: async () => {
                action_started.resolve(undefined);
                await action_release.promise;
            },
        };
        registerHandlerMap({ setSnapValue: handler });

        const action = executeAppAction({ type: 'setSnapValue', payload: { value: 0.5 } });
        await action_started.promise;
        const transition = newProject('Replacement');
        await Promise.resolve();
        await Promise.resolve();

        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectStore.value).toMatchObject({
            name: 'Existing Project',
            loading: false,
            initialized: true,
        });

        action_release.resolve(undefined);
        await expect(action).resolves.toBeUndefined();
        await expect(transition).resolves.toBe(true);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });
});
