import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearRuntimeCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    compactProject,
    createCrdtProject,
    projectActionHistoryToStore,
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { isCanonicalProjectId } from '../../../models/ProjectData';
import { removeProjectJson } from '../../../repositories/project/removeProjectJson';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { getDurableProjectOwnerId } from '../../getDurableProjectOwnerId';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { newProject } from '../newProject';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

const pluginHostMocks = vi.hoisted(() => ({
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));

function createDeferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });

    return { promise, resolve: resolveDeferred };
}

// newProject imports ensureTrackStrips and stopPlayback.
vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: vi.fn(),
    stopPlayback: vi.fn(),
}));

// newProject imports clearRuntimeCachedAudioBuffers and resetAudioGraph.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    resetAudioGraph: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: pluginHostMocks.unloadPlugin,
    activateExternalPlugin: vi.fn(),
    findSupportedPlugin: vi.fn(),
    isFaustInstrumentModule: vi.fn(),
    registerFaustDSP: vi.fn(),
    resetExternalPluginRuntimeForGraphRebuild: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
    compactProject: vi.fn().mockResolvedValue(undefined),
    createCrdtDoc: vi.fn(),
    createCrdtProject: vi.fn().mockResolvedValue(undefined),
    DOC_BRANCHES: '__branches__',
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn(),
    hasCrdtDoc: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
    preserveBranchStateForSession: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    removeCrdtDoc: vi.fn(),
    replaceBranchState: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
    restoreBranchStateAfterSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: vi.fn().mockReturnValue(() => {}),
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));

vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));

// newProject imports runProjectLoadTransaction; activateNewProject uses projectLoadEpoch at runtime.
vi.mock('../helpers/runProjectLoadTransaction', async () => {
    const actual = await vi.importActual<typeof import('../helpers/runProjectLoadTransaction')>(
        '../helpers/runProjectLoadTransaction'
    );
    return {
        projectLoadEpoch: actual.projectLoadEpoch,
        runProjectLoadTransaction: vi.fn(() => ({
            prepare: vi.fn(() => Promise.resolve(true)),
            activate: vi.fn(() => true),
            canActivate: () => true,
            isCurrent: () => true,
            signal: new AbortController().signal,
        })),
    };
});

// newProject imports addTrack; getDurableProjectOwnerId pulls getPluginById via semanticProjectIndex.
vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    getPluginById: vi.fn(),
}));

// newProject imports clearUndoHistory.
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeUserAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));

vi.mock('../../../repositories/project/removeProjectJson', () => ({
    removeProjectJson: vi.fn(),
}));

describe('newProject injectable', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        pluginHostMocks.unloadPlugin.mockResolvedValue(undefined);
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
        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(resetAudioGraph).toHaveBeenCalledTimes(1);
        expect(pluginHostMocks.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(resetModuleStoresToDefault).toHaveBeenCalledWith({ createNewMidiProbabilitySeed: true });
        expect(resetCrdtProjectAuthority).toHaveBeenCalledWith('Test');
        expect(compactProject).toHaveBeenCalledOnce();
        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectActionHistoryToStore).toHaveBeenCalledTimes(1);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Master', kind: 'master', select: false });
        expect(removeProjectJson).toHaveBeenCalledTimes(1);
        expect(clearRuntimeCachedAudioBuffers).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);

        const remove_project_json_order = vi.mocked(removeProjectJson).mock.invocationCallOrder[0];
        const clear_audio_buffers_order = vi.mocked(clearRuntimeCachedAudioBuffers).mock.invocationCallOrder[0];
        const clear_undo_history_order = vi.mocked(clearUndoHistory).mock.invocationCallOrder[0];
        if (
            remove_project_json_order === undefined ||
            clear_audio_buffers_order === undefined ||
            clear_undo_history_order === undefined
        ) {
            throw new Error('expected removeProjectJson, clearRuntimeCachedAudioBuffers, and clearUndoHistory calls');
        }

        expect(clear_audio_buffers_order).toBeGreaterThan(remove_project_json_order);
        expect(clear_audio_buffers_order).toBeLessThan(clear_undo_history_order);
    });

    it('mints unique canonical identities for projects created in the same millisecond', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        try {
            await expect(newProject('First')).resolves.toBe(true);
            const firstProjectId = projectStore.value?.projectId;

            await expect(newProject('Second')).resolves.toBe(true);
            const secondProjectId = projectStore.value?.projectId;

            expect(isCanonicalProjectId(firstProjectId)).toBe(true);
            expect(isCanonicalProjectId(secondProjectId)).toBe(true);
            expect(secondProjectId).not.toBe(firstProjectId);
        } finally {
            now.mockRestore();
        }
    });

    it('does not replace authority when superseded during native teardown', async () => {
        const unloading = createDeferred<void>();
        let isCurrent = true;
        vi.mocked(runProjectLoadTransaction).mockReturnValueOnce({
            prepare: vi.fn().mockResolvedValue(true),
            activate: vi.fn().mockReturnValue(true),
            canActivate: () => isCurrent,
            isCurrent: () => isCurrent,
            signal: new AbortController().signal,
        });
        pluginHostMocks.unloadPlugin.mockReturnValueOnce(unloading.promise);
        const activation = newProject('Older Project');
        await vi.waitFor(() => expect(pluginHostMocks.unloadPlugin).toHaveBeenCalledOnce());
        isCurrent = false;
        unloading.resolve(undefined);
        await expect(activation).resolves.toBe(false);
        expect(resetCrdtProjectAuthority).not.toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('keeps previous authority and restores its graph when native plugin teardown fails', async () => {
        pluginHostMocks.unloadPlugin.mockRejectedValueOnce(new Error('native teardown failed'));
        await expect(newProject('Test')).resolves.toBe(false);
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('restores the previous project when authority reset fails before commit', async () => {
        vi.mocked(resetCrdtProjectAuthority).mockImplementationOnce(() => {
            throw new Error('CRDT setup failed');
        });

        const activated = await newProject('Broken Project');

        expect(activated).toBe(false);
        expect(projectStore.value).toMatchObject({
            name: 'Existing Project',
            loading: false,
            initialized: true,
        });
        expect(clearRuntimeCachedAudioBuffers).not.toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    it('completes the committed project when initial compaction rejects after authority swaps', async () => {
        let activeAuthority = 'Existing Project';
        vi.mocked(resetCrdtProjectAuthority).mockImplementationOnce((name) => {
            activeAuthority = name;
        });
        vi.mocked(compactProject).mockImplementationOnce(() => {
            expect(activeAuthority).toBe('Degraded Project');
            return Promise.reject(new Error('initial compaction failed'));
        });

        const activated = await newProject('Degraded Project');

        expect(activated).toBe(true);
        expect(activeAuthority).toBe('Degraded Project');
        expect(resetModuleStoresToDefault).toHaveBeenCalledOnce();
        expect(projectStore.value).toMatchObject({
            name: 'Degraded Project',
            loading: false,
            initialized: true,
        });
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();

        const authorityOrder = vi.mocked(resetCrdtProjectAuthority).mock.invocationCallOrder[0];
        const compactionOrder = vi.mocked(compactProject).mock.invocationCallOrder[0];
        const storeResetOrder = vi.mocked(resetModuleStoresToDefault).mock.invocationCallOrder[0];
        if (authorityOrder === undefined || compactionOrder === undefined || storeResetOrder === undefined) {
            throw new Error('expected authority, compaction, and project publication calls');
        }
        expect(storeResetOrder).toBeGreaterThan(authorityOrder);
        expect(compactionOrder).toBeGreaterThan(storeResetOrder);
    });

    it('keeps committed project authority published when a newer preparation fails during compaction', async () => {
        const compaction = createDeferred<void>();
        let latestTransition = 1;
        vi.mocked(runProjectLoadTransaction)
            .mockReturnValueOnce({
                prepare: vi.fn().mockResolvedValue(true),
                activate: vi.fn().mockReturnValue(true),
                canActivate: () => latestTransition === 1,
                isCurrent: () => latestTransition === 1,
                signal: new AbortController().signal,
            })
            .mockReturnValueOnce({
                prepare: vi.fn().mockImplementation(() => {
                    latestTransition = 2;
                    return Promise.reject(new Error('newer preparation failed'));
                }),
                activate: vi.fn().mockReturnValue(false),
                canActivate: () => true,
                isCurrent: () => false,
                signal: new AbortController().signal,
            });
        vi.mocked(compactProject).mockReturnValueOnce(compaction.promise);

        const committedActivation = newProject('Committed Project');
        await vi.waitFor(() => expect(compactProject).toHaveBeenCalledOnce());

        const failedNewerActivation = newProject('Failed Newer Project');
        await expect(failedNewerActivation).resolves.toBe(false);

        compaction.resolve(undefined);

        await expect(committedActivation).resolves.toBe(true);
        expect(projectStore.value).toMatchObject({
            name: 'Committed Project',
            loading: false,
            initialized: true,
        });
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();

        const autosaveOrder = vi.mocked(startCrdtAutoSave).mock.invocationCallOrder[0];
        const compactionOrder = vi.mocked(compactProject).mock.invocationCallOrder[0];
        if (autosaveOrder === undefined || compactionOrder === undefined) {
            throw new Error('expected autosave and compaction calls');
        }
        expect(autosaveOrder).toBeLessThan(compactionOrder);
    });

    it('does not clear loading when an older activation is superseded', async () => {
        const playbackStop = createDeferred<void>();
        let isCurrent = true;
        vi.mocked(runProjectLoadTransaction).mockReturnValueOnce({
            prepare: vi.fn().mockResolvedValue(true),
            activate: vi.fn().mockReturnValue(true),
            canActivate: () => isCurrent,
            isCurrent: () => isCurrent,
            signal: new AbortController().signal,
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

    it('withholds the durable owner identity until the initial compaction persists it', async () => {
        const compaction = createDeferred<void>();
        vi.mocked(compactProject).mockReturnValueOnce(compaction.promise);

        const activation = newProject('Barrier Project');
        await vi.waitFor(() => expect(compactProject).toHaveBeenCalledOnce());

        const publishedProjectId = projectStore.value?.projectId;
        expect(isCanonicalProjectId(publishedProjectId)).toBe(true);
        expect(projectStore.value).toMatchObject({ initialized: true, identityPersistencePending: true });
        expect(getDurableProjectOwnerId()).toBeUndefined();

        compaction.resolve(undefined);
        await expect(activation).resolves.toBe(true);

        expect(projectStore.value).toMatchObject({ identityPersistencePending: false });
        expect(getDurableProjectOwnerId()).toBe(publishedProjectId);
    });

    it('keeps the durable owner identity withheld when the initial compaction fails', async () => {
        vi.mocked(compactProject).mockRejectedValueOnce(new Error('initial compaction failed'));

        await expect(newProject('Unpersisted Project')).resolves.toBe(true);

        expect(isCanonicalProjectId(projectStore.value?.projectId)).toBe(true);
        expect(projectStore.value).toMatchObject({ initialized: true, identityPersistencePending: true });
        expect(getDurableProjectOwnerId()).toBeUndefined();
    });

    it('does not clear the persistence barrier of a superseded project', async () => {
        const compaction = createDeferred<void>();
        let latestTransition = 1;
        vi.mocked(runProjectLoadTransaction)
            .mockReturnValueOnce({
                prepare: vi.fn().mockResolvedValue(true),
                activate: vi.fn().mockReturnValue(true),
                canActivate: () => latestTransition === 1,
                isCurrent: () => latestTransition === 1,
                signal: new AbortController().signal,
            })
            .mockReturnValueOnce({
                prepare: vi.fn().mockResolvedValue(true),
                activate: vi.fn().mockReturnValue(true),
                canActivate: () => true,
                isCurrent: () => true,
                signal: new AbortController().signal,
            });
        vi.mocked(compactProject).mockReturnValueOnce(compaction.promise);

        const firstActivation = newProject('First Project');
        await vi.waitFor(() => expect(compactProject).toHaveBeenCalledOnce());
        const firstProjectId = projectStore.value?.projectId;

        latestTransition = 2;
        await expect(newProject('Second Project')).resolves.toBe(true);
        expect(projectStore.value).toMatchObject({ name: 'Second Project', identityPersistencePending: false });

        compaction.resolve(undefined);
        await expect(firstActivation).resolves.toBe(true);

        expect(projectStore.value?.projectId).not.toBe(firstProjectId);
        expect(projectStore.value).toMatchObject({ name: 'Second Project', identityPersistencePending: false });
    });
});
