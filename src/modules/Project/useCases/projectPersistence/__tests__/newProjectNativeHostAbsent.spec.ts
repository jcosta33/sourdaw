import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearUndoHistory } from '#/modules/Command/useCases';
import { compactProject, resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { newProject } from '../newProject';

/**
 * The deployment context of issue #2207: an Electron shell whose native addon
 * never loaded. The preload still published `window.sourdaw`, so
 * `isDesktopRuntime()` is true, and the main process answers every command with
 * "<command> rejected: the native host is not available". The renderer must
 * treat that like the web platform — activation completes, the workspace
 * mounts — not like a hard failure that bounces the launch screen home.
 *
 * `#/modules/PluginHost/useCases` is deliberately NOT mocked here: project
 * activation awaits its unkeyed `unloadPlugin`, which is the call whose
 * rejection used to fail activation. Everything else newProject touches is
 * mocked exactly as `newProject.spec.ts` mocks it.
 */
const pluginHostMocks = vi.hoisted(() => ({
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    unloadPlugin: pluginHostMocks.unloadPlugin,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    resetAudioGraph: vi.fn(),
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

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    getPluginById: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    executeUserAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));

vi.mock('../../../repositories/project/removeProjectJson', () => ({
    removeProjectJson: vi.fn(),
}));

describe('newProject with the native host absent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            name: 'Existing Project',
            loading: false,
            initialized: true,
        });
    });

    it('completes activation and publishes a workspace-ready project', async () => {
        await expect(newProject('Hostless Project')).resolves.toBe(true);

        // Activation really drove the native teardown into the rejecting bridge.
        expect(pluginHostMocks.unloadPlugin).toHaveBeenCalled();
        expect(resetCrdtProjectAuthority).toHaveBeenCalledWith('Hostless Project');

        // `initialized: true` with `loading: false` is what AppShell's ready
        // latch reads to mount the workspace over the launch screen.
        expect(projectStore.value).toMatchObject({
            name: 'Hostless Project',
            initialized: true,
            loading: false,
        });
        expect(compactProject).toHaveBeenCalledOnce();
        expect(clearUndoHistory).toHaveBeenCalledOnce();
        expect(stopPlayback).toHaveBeenCalledOnce();
        expect(ensureTrackStrips).not.toHaveBeenCalled();
        expect(resetModuleStoresToDefault).toHaveBeenCalledWith({ createNewMidiProbabilitySeed: true });
    });
});
