import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { addTrack } from '#/modules/Arrangement/useCases';
import {
    clearRuntimeCachedAudioBuffers,
    forgetProjectLatchedPedals,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    compactProject,
    createCrdtProject,
    projectActionHistoryToStore,
    resetCrdtProject,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { isCanonicalProjectId } from '../../../models/ProjectData';
import { removeProjectJson } from '../../../repositories/project/removeProjectJson';
import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
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

const resetMocks = vi.hoisted(() => ({
    resetCrdtProject: vi.fn(),
    finalize: vi.fn(),
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

// newProject imports clearRuntimeCachedAudioBuffers, forgetProjectLatchedPedals and resetAudioGraph.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    forgetProjectLatchedPedals: vi.fn(),
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
    beginBranchSession: vi.fn(),
    projectActionHistoryToStore: vi.fn(),
    removeCrdtDoc: vi.fn(),
    projectBranchSession: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    resetCrdtProject: resetMocks.resetCrdtProject,
    resetCrdtProjectAuthority: vi.fn(),
    endBranchSession: vi.fn(),
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
        resetMocks.finalize.mockReset();
        resetMocks.finalize.mockResolvedValue('finalized');
        resetMocks.resetCrdtProject.mockReset();
        // A replacing reset always reports the point of no return, so the
        // default has to as well: every `authorityReplaced` branch depends on it.
        resetMocks.resetCrdtProject.mockImplementation((_name: string, onAuthorityReplaced?: () => void) => {
            onAuthorityReplaced?.();
            return Promise.resolve({ status: 'replaced', finalize: resetMocks.finalize });
        });
        projectLoadFailureStore.set(null);
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
        expect(resetCrdtProject).toHaveBeenCalledWith('Test', expect.any(Function));
        // The fresh project owns the document from that call on, so the pedals
        // latched under the project just left are forgotten here and not at the
        // earlier graph reset, which an abort can still undo.
        expect(forgetProjectLatchedPedals).toHaveBeenCalledOnce();
        expect(vi.mocked(forgetProjectLatchedPedals).mock.invocationCallOrder[0]!).toBeGreaterThan(
            vi.mocked(resetCrdtProject).mock.invocationCallOrder[0]!
        );
        expect(compactProject).toHaveBeenCalledOnce();
        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectActionHistoryToStore).toHaveBeenCalledTimes(1);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Master', kind: 'master', select: false });
        expect(removeProjectJson).toHaveBeenCalledTimes(1);
        expect(clearRuntimeCachedAudioBuffers).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
        // C3 — the replacement is not the durable project until the reset is
        // finalized, so autosave (which compacts) must not run before then.
        expect(resetMocks.finalize).toHaveBeenCalledOnce();
        expect(vi.mocked(compactProject).mock.invocationCallOrder[0]!).toBeLessThan(
            resetMocks.finalize.mock.invocationCallOrder[0]!
        );
        expect(resetMocks.finalize.mock.invocationCallOrder[0]!).toBeLessThan(
            vi.mocked(startCrdtAutoSave).mock.invocationCallOrder[0]!
        );
        expect(projectStore.value).toMatchObject({ identityPersistencePending: false });

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
        expect(resetCrdtProject).not.toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
        // The player stays in the old project, whose graph is rebuilt above, so
        // a damper still held must survive the abandoned activation.
        expect(forgetProjectLatchedPedals).not.toHaveBeenCalled();
    });

    it('keeps previous authority and restores its graph when native plugin teardown fails', async () => {
        pluginHostMocks.unloadPlugin.mockRejectedValueOnce(new Error('native teardown failed'));
        await expect(newProject('Test')).resolves.toBe(false);
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('restores the previous project when authority reset fails before commit', async () => {
        vi.mocked(resetCrdtProject).mockImplementationOnce(() => {
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

    // C1 — every refusal is decided before the switch, so the previous project
    // is still the live one and this is an ordinary abort.
    it('hands the previous project back when the reset is refused', async () => {
        vi.mocked(resetCrdtProject).mockResolvedValueOnce({ status: 'refused', reason: 'session-active' });

        await expect(newProject('Refused Project')).resolves.toBe(false);

        expect(projectStore.value).toMatchObject({
            name: 'Existing Project',
            loading: false,
            initialized: true,
        });
        expect(ensureTrackStrips).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
        expect(compactProject).not.toHaveBeenCalled();
        expect(resetMocks.finalize).not.toHaveBeenCalled();
        expect(projectLoadFailureStore.value).toBeNull();
    });

    /**
     * C4 — past the point of no return the previous project is out of the
     * repository and out of the stores. Rebuilding its graph would only look
     * like a recovery, and restarting autosave would compact the empty project
     * over the user's own on disk, so the failure gets its own surface instead.
     */
    it('publishes a failure instead of a recovery when a step throws past the switch', async () => {
        vi.mocked(resetCrdtProject).mockImplementationOnce((_name, onAuthorityReplaced) => {
            onAuthorityReplaced?.();
            return Promise.resolve({ status: 'replaced', finalize: resetMocks.finalize });
        });
        vi.mocked(forgetProjectLatchedPedals).mockImplementationOnce(() => {
            throw new Error('latched pedal bookkeeping failed');
        });

        await expect(newProject('Lost Project')).resolves.toBe(false);

        expect(projectLoadFailureStore.value).toMatchObject({ projectName: 'Lost Project' });
        expect(ensureTrackStrips).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(projectStore.value).toMatchObject({ loading: true, initialized: false });
        // The marker is settled on every path past the switch, this one
        // included: an unsettled marker is what the next boot would have to
        // classify, and what would refuse the session's next reset.
        expect(resetMocks.finalize).toHaveBeenCalledOnce();
    });

    /**
     * C6 — the first activation left the reset unfinalized. A second New
     * Project in the same session is an ordinary reset: it runs the whole
     * sequence again and finalizes, rather than being turned away.
     */
    it('activates a second project in the same session after the first reset could not finalize', async () => {
        vi.mocked(compactProject).mockRejectedValueOnce(new Error('initial compaction failed'));
        resetMocks.finalize.mockResolvedValueOnce('authority-mismatch');

        await expect(newProject('Unpersisted Project')).resolves.toBe(true);
        await expect(newProject('Second Project')).resolves.toBe(true);

        expect(resetCrdtProject).toHaveBeenCalledTimes(2);
        expect(resetMocks.finalize).toHaveBeenCalledTimes(2);
        expect(projectStore.value).toMatchObject({ name: 'Second Project', identityPersistencePending: false });
        expect(startCrdtAutoSave).toHaveBeenCalledOnce();
    });

    // C2 — a failed initial snapshot means nothing of the replacement reached
    // storage, so the reset cannot finalize and autosave must stay stopped:
    // starting it would compact this project over the user's own on disk.
    it('completes the committed project when initial compaction rejects after authority swaps', async () => {
        let activeAuthority = 'Existing Project';
        vi.mocked(resetCrdtProject).mockImplementationOnce((name) => {
            activeAuthority = name;
            return Promise.resolve({ status: 'replaced', finalize: resetMocks.finalize });
        });
        resetMocks.finalize.mockResolvedValue('authority-mismatch');
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
            identityPersistencePending: true,
        });
        expect(resetMocks.finalize).toHaveBeenCalledOnce();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();

        const authorityOrder = vi.mocked(resetCrdtProject).mock.invocationCallOrder[0];
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
        // C3 — autosave belongs after the snapshot and its finalization, never
        // alongside the compare-and-swap that decides the reset's fate.
        expect(autosaveOrder).toBeGreaterThan(compactionOrder);
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
        // Nothing of the replacement committed, so the reset cannot finalize.
        resetMocks.finalize.mockResolvedValue('authority-mismatch');

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
