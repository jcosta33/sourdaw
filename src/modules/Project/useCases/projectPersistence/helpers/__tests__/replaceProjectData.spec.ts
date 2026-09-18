import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockLogger,
    mockBatchStoreUpdates,
    mockClearRuntimeCachedAudioBuffers,
    mockForgetProjectLatchedPedals,
    mockGetAudioContext,
    mockImportCachedAudioBuffers,
    mockCancelPreparedStoredBuffers,
    mockPrepareCachedAudioBuffersFromIdb,
    mockResetAudioGraph,
    mockClearUndoHistory,
    mockCompactProject,
    mockProjectActionHistoryToStore,
    mockResetCrdtProject,
    mockFinalizeReset,
    mockStartCrdtAutoSave,
    mockUnloadLoadedExternalPlugins,
    mockEnsureTrackStrips,
    mockStopPlayback,
    mockNotifyUser,
    mockProjectStore,
    mockProjectLoadFailureStore,
    mockAutoSaveHandle,
    mockStopActiveAutoSave,
    mockHydrateArrangement,
    mockHydrateModuleStores,
    mockResetModuleStores,
    mockVerifyAudioBufferReferences,
} = vi.hoisted(() => ({
    mockLogger: { error: vi.fn(), warn: vi.fn() },
    mockBatchStoreUpdates: vi.fn((fn: () => void) => fn()),
    mockClearRuntimeCachedAudioBuffers: vi.fn(),
    mockForgetProjectLatchedPedals: vi.fn(),
    mockGetAudioContext: vi.fn(() => ({ sampleRate: 44100 })),
    mockImportCachedAudioBuffers: vi.fn(() =>
        Promise.resolve({ publish: vi.fn(), persist: () => Promise.resolve(true) })
    ),
    mockCancelPreparedStoredBuffers: vi.fn(),
    mockPrepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: vi.fn(), publish: vi.fn() })),
    mockResetAudioGraph: vi.fn(),
    mockClearUndoHistory: vi.fn(),
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockProjectActionHistoryToStore: vi.fn(),
    mockResetCrdtProject: vi.fn(),
    mockFinalizeReset: vi.fn(),
    mockStartCrdtAutoSave: vi.fn(() => 'auto-save-handle'),
    mockUnloadLoadedExternalPlugins: vi.fn(() => Promise.resolve()),
    mockEnsureTrackStrips: vi.fn(),
    mockStopPlayback: vi.fn(() => Promise.resolve()),
    mockNotifyUser: vi.fn(),
    mockProjectStore: {
        value: null as Record<string, unknown> | null,
        set: vi.fn(),
    },
    mockProjectLoadFailureStore: {
        value: null as Record<string, unknown> | null,
        set: vi.fn(),
    },
    mockAutoSaveHandle: { setAutoSaveHandle: vi.fn() },
    mockStopActiveAutoSave: vi.fn(),
    mockHydrateArrangement: vi.fn(),
    mockHydrateModuleStores: vi.fn(),
    mockResetModuleStores: vi.fn(),
    mockVerifyAudioBufferReferences: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));
vi.mock('#/infra/store/createStore', () => ({ batchStoreUpdates: mockBatchStoreUpdates }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearRuntimeCachedAudioBuffers: mockClearRuntimeCachedAudioBuffers,
    forgetProjectLatchedPedals: mockForgetProjectLatchedPedals,
    getAudioContext: mockGetAudioContext,
    importCachedAudioBuffers: mockImportCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb: mockPrepareCachedAudioBuffersFromIdb,
    resetAudioGraph: mockResetAudioGraph,
    cancelPendingAudioBufferImport: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: mockClearUndoHistory,
    executeUserAppAction: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject: mockCompactProject,
    projectActionHistoryToStore: mockProjectActionHistoryToStore,
    resetCrdtProject: mockResetCrdtProject,
    startCrdtAutoSave: mockStartCrdtAutoSave,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: mockUnloadLoadedExternalPlugins,
}));
vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mockEnsureTrackStrips,
    stopPlayback: mockStopPlayback,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('../../../../stores/projectStore', () => ({ projectStore: mockProjectStore }));
vi.mock('../../../../stores/projectLoadFailureStore', () => ({ projectLoadFailureStore: mockProjectLoadFailureStore }));
vi.mock('../autoSaveHandle', () => mockAutoSaveHandle);
vi.mock('../stopActiveAutoSave', () => ({ stopActiveAutoSave: mockStopActiveAutoSave }));
vi.mock('../hydrateArrangementStoreFromProjectData', () => ({
    hydrateArrangementStoreFromProjectData: mockHydrateArrangement,
}));
vi.mock('../hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: mockHydrateModuleStores,
}));
vi.mock('../resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: mockResetModuleStores }));
vi.mock('../verifyAudioBufferReferences', () => ({ verifyAudioBufferReferences: mockVerifyAudioBufferReferences }));

import { createDefaultProductionBrief } from '../../../../models/ProductionBrief';
import { replaceProjectData } from '../replaceProjectData';

import type { HydratableProjectData, HydratableProjectTrack } from '../isHydratableProjectData';
import type { ProjectLoadTransaction } from '../runProjectLoadTransaction';

function makeData(referencedBufferId?: string): HydratableProjectData {
    const tracks: HydratableProjectTrack[] = [];
    if (referencedBufferId) {
        tracks.push({
            id: 'track-1',
            name: 'Track 1',
            kind: 'audio',
            clips: [
                {
                    id: 'clip-1',
                    trackId: 'track-1',
                    name: 'Clip 1',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#ffffff',
                    locked: false,
                    muted: false,
                    bufferId: referencedBufferId,
                },
            ],
        });
    }
    return {
        version: 1,
        meta: {
            name: 'Test Project',
            createdAt: 1,
            updatedAt: 2,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        arrangement: { tracks },
    };
}

function makeTransaction(overrides: Partial<ProjectLoadTransaction> = {}): ProjectLoadTransaction {
    const { signal = new AbortController().signal, ...transactionOverrides } = overrides;
    return {
        prepare: () => Promise.resolve(true),
        activate: () => true,
        canActivate: () => true,
        isCurrent: () => true,
        signal,
        ...transactionOverrides,
    };
}

describe('replaceProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockProjectStore.value = null;
        mockImportCachedAudioBuffers.mockResolvedValue({ publish: vi.fn(), persist: () => Promise.resolve(true) });
        mockPrepareCachedAudioBuffersFromIdb.mockResolvedValue({
            cancel: mockCancelPreparedStoredBuffers,
            publish: vi.fn(),
        });
        mockStopPlayback.mockResolvedValue(undefined);
        mockCompactProject.mockResolvedValue(undefined);
        mockStartCrdtAutoSave.mockReturnValue('handle');
        mockFinalizeReset.mockResolvedValue('finalized');
        // A replacing reset always reports the point of no return, so the
        // default has to as well: every `authorityReplaced` branch depends on it.
        mockResetCrdtProject.mockImplementation((_name: string, onAuthorityReplaced?: () => void) => {
            onAuthorityReplaced?.();
            return Promise.resolve({ status: 'replaced', finalize: mockFinalizeReset });
        });
        mockUnloadLoadedExternalPlugins.mockResolvedValue(undefined);
    });

    it('aborts when transaction.prepare returns false', async () => {
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction({ prepare: () => Promise.resolve(false) }),
        });
        expect(result.status).toBe('aborted');
        expect(mockClearRuntimeCachedAudioBuffers).not.toHaveBeenCalled();
    });

    it('aborts when transaction.activate returns false', async () => {
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction({ activate: () => false }),
        });
        expect(result.status).toBe('aborted');
    });

    it('does not switch project authority after an external discard authority is revoked during preparation', async () => {
        let allowed = true;
        mockPrepareCachedAudioBuffersFromIdb.mockImplementation(async () => {
            allowed = false;
            return { cancel: mockCancelPreparedStoredBuffers, publish: vi.fn() };
        });

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            shouldProceed: () => allowed,
            transaction: makeTransaction(),
        });

        expect(result.status).toBe('aborted');
        expect(mockResetCrdtProject).not.toHaveBeenCalled();
    });

    it('aborts when transaction.prepare throws', async () => {
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction({ prepare: () => Promise.reject(new Error('IDB failed')) }),
        });
        expect(result.status).toBe('aborted');
        expect(mockLogger.error).toHaveBeenCalled();
    });

    it('sets loading state on project store before preparation', async () => {
        mockProjectStore.value = { name: 'Old', initialized: true };
        await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });
        // First set call should mark loading: true
        const firstCall = mockProjectStore.set.mock.calls[0]?.[0];
        expect(firstCall).toMatchObject({ loading: true, initialized: false });
    });

    it('commits successfully when all steps pass', async () => {
        const storedPublish = vi.fn();
        const embeddedPublish = vi.fn();
        mockPrepareCachedAudioBuffersFromIdb.mockResolvedValue({
            cancel: mockCancelPreparedStoredBuffers,
            publish: storedPublish,
        });
        mockImportCachedAudioBuffers.mockResolvedValue({
            publish: embeddedPublish,
            persist: () => Promise.resolve(true),
        });

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData('shared-buffer'),
            transaction: makeTransaction(),
        });
        expect(result.status).toBe('committed');
        if (result.status === 'committed') {
            expect(result.degraded).toBe(false);
            expect(result.durable).toBe(true);
        }
        expect(mockStopPlayback).toHaveBeenCalled();
        expect(mockResetAudioGraph).toHaveBeenCalled();
        expect(mockUnloadLoadedExternalPlugins).toHaveBeenCalledOnce();
        // Second argument is the point-of-no-return callback the abort path
        // uses to tell a recoverable failure from an unrecoverable one.
        expect(mockResetCrdtProject).toHaveBeenCalledWith('Test Project', expect.any(Function));
        // The loaded project owns the document from that call on, so the pedals
        // latched under the project just left are forgotten here and not at the
        // earlier graph reset, which an abort can still undo.
        expect(mockForgetProjectLatchedPedals).toHaveBeenCalledOnce();
        expect(mockForgetProjectLatchedPedals.mock.invocationCallOrder[0]!).toBeGreaterThan(
            mockResetCrdtProject.mock.invocationCallOrder[0]!
        );
        expect(mockResetModuleStores).toHaveBeenCalled();
        expect(mockHydrateArrangement).toHaveBeenCalled();
        expect(mockClearUndoHistory).toHaveBeenCalled();
        expect(mockClearRuntimeCachedAudioBuffers).toHaveBeenCalledOnce();
        expect(mockClearRuntimeCachedAudioBuffers).toHaveBeenCalledWith({ retainedIds: ['shared-buffer'] });
        expect(mockClearRuntimeCachedAudioBuffers.mock.invocationCallOrder[0]).toBeLessThan(
            storedPublish.mock.invocationCallOrder[0]!
        );
        expect(mockClearRuntimeCachedAudioBuffers.mock.invocationCallOrder[0]).toBeLessThan(
            embeddedPublish.mock.invocationCallOrder[0]!
        );
        // C3 — the durability lifecycle starts only once the reset is
        // finalized: an autosave compacting before then would move the durable
        // authority past the one the reset recorded.
        expect(mockFinalizeReset).toHaveBeenCalledOnce();
        expect(mockFinalizeReset.mock.invocationCallOrder[0]!).toBeGreaterThan(
            mockCompactProject.mock.invocationCallOrder[0]!
        );
        expect(mockAutoSaveHandle.setAutoSaveHandle.mock.invocationCallOrder[0]!).toBeGreaterThan(
            mockFinalizeReset.mock.invocationCallOrder[0]!
        );
    });

    it('hydrates the saved production brief as project truth', async () => {
        const productionBrief = {
            ...createDefaultProductionBrief(1),
            revision: 2,
            vision: 'Intimate verses',
            sourceRunLinks: [{ id: 'source-link-2', sourceRunId: 'run-2', createdAt: 102 }],
            updatedAt: 2,
        };
        const data = makeData();
        data.meta.productionBrief = productionBrief;

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data,
            transaction: makeTransaction(),
        });

        expect(result.status).toBe('committed');
        expect(mockProjectStore.set).toHaveBeenCalledWith(expect.objectContaining({ productionBrief }));
    });

    it('hydrates the canonical project identity from the saved envelope', async () => {
        const data = makeData();
        data.version = 2;
        data.meta.projectId = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data,
            transaction: makeTransaction(),
        });

        expect(result.status).toBe('committed');
        expect(mockProjectStore.set).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa' })
        );
    });

    it('does not replace authority when superseded during native teardown', async () => {
        const unloading = Promise.withResolvers<void>();
        let isCurrent = true;
        mockUnloadLoadedExternalPlugins.mockReturnValueOnce(unloading.promise);

        const replacement = replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction({ isCurrent: () => isCurrent }),
        });
        await vi.waitFor(() => expect(mockUnloadLoadedExternalPlugins).toHaveBeenCalledOnce());
        isCurrent = false;
        unloading.resolve();

        await expect(replacement).resolves.toEqual({ status: 'aborted' });
        expect(mockResetCrdtProject).not.toHaveBeenCalled();
        expect(mockEnsureTrackStrips).toHaveBeenCalledOnce();
        // The player stays in the old project, whose graph is rebuilt above, so
        // a damper still held must survive the abandoned load.
        expect(mockForgetProjectLatchedPedals).not.toHaveBeenCalled();
    });

    it('cancels the stored-buffer candidate when playback shutdown fails before publication', async () => {
        mockStopPlayback.mockRejectedValueOnce(new Error('stop failed'));

        await expect(
            replaceProjectData({
                context: 'loadRecentProject',
                data: makeData('stored-buffer'),
                transaction: makeTransaction(),
            })
        ).resolves.toEqual({ status: 'aborted' });

        expect(mockCancelPreparedStoredBuffers).toHaveBeenCalledOnce();
        expect(mockResetCrdtProject).not.toHaveBeenCalled();
    });
    /**
     * The marker is settled on every path past the authority switch, this one
     * included: the loaded project never became durable, and finalization is
     * what records that where the next boot reads it.
     */
    it('settles the reset when a step throws past the authority switch', async () => {
        mockProjectActionHistoryToStore.mockImplementationOnce(() => {
            throw new Error('action history projection failed');
        });

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });

        expect(result.status).toBe('failed');
        expect(mockFinalizeReset).toHaveBeenCalledOnce();
        expect(mockStartCrdtAutoSave).not.toHaveBeenCalled();
    });

    it('returns degraded=true when a committed step fails', async () => {
        mockHydrateArrangement.mockImplementation(() => {
            throw new Error('hydrate failed');
        });
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });
        expect(result.status).toBe('committed');
        if (result.status === 'committed') {
            expect(result.degraded).toBe(true);
            expect(result.durable).toBe(true);
        }
        expect(mockNotifyUser).toHaveBeenCalledWith(
            'Project loaded with recovery errors. Save a new copy before closing.',
            'warning'
        );
    });

    it('reports a committed replacement as non-durable only when CRDT snapshot compaction fails', async () => {
        // The published project the barrier is raised on; the store mock does
        // not feed its own writes back, so this stands in for it.
        mockProjectStore.value = { name: 'Test Project', identityPersistencePending: false };
        mockCompactProject.mockRejectedValueOnce(new Error('snapshot persistence failed'));
        // Nothing of the replacement reached storage, so the reset cannot
        // finalize and the marker stays for the next boot to classify.
        mockFinalizeReset.mockResolvedValue('authority-mismatch');

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });

        expect(result).toMatchObject({ status: 'committed', degraded: true, durable: false });
        // C2 — the marker is settled either way, and autosave stays stopped
        // because this project is not the durable one.
        expect(mockFinalizeReset).toHaveBeenCalledOnce();
        expect(mockAutoSaveHandle.setAutoSaveHandle).not.toHaveBeenCalled();
        expect(mockProjectStore.set).toHaveBeenCalledWith(
            expect.objectContaining({ identityPersistencePending: true })
        );
    });

    // C1 — every refusal is decided before the switch, so the previous project
    // is still the live one and this is an ordinary abort.
    it('hands the previous project back when the reset is refused', async () => {
        mockProjectStore.value = { name: 'Old', initialized: true, loading: false };
        mockResetCrdtProject.mockResolvedValue({ status: 'refused', reason: 'lock-unavailable' });

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });

        expect(result).toEqual({ status: 'aborted' });
        expect(mockEnsureTrackStrips).toHaveBeenCalledOnce();
        expect(mockAutoSaveHandle.setAutoSaveHandle).toHaveBeenCalledOnce();
        expect(mockCompactProject).not.toHaveBeenCalled();
        expect(mockFinalizeReset).not.toHaveBeenCalled();
        expect(mockProjectLoadFailureStore.set).not.toHaveBeenCalled();
    });

    /**
     * C2/C4 — a reset that cannot finalize leaves the loaded project
     * non-durable: the durability barrier stays raised and autosave stays
     * stopped even though the snapshot itself landed.
     */
    it('withholds durability when the snapshot landed but the reset did not finalize', async () => {
        mockFinalizeReset.mockResolvedValue('authority-mismatch');

        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });

        expect(result).toMatchObject({ status: 'committed', durable: false });
        expect(mockAutoSaveHandle.setAutoSaveHandle).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalled();
    });

    it('aborts when embedded buffer import returns null', async () => {
        vi.mocked(mockImportCachedAudioBuffers).mockResolvedValue(null as never);
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });
        expect(result.status).toBe('aborted');
    });
});
