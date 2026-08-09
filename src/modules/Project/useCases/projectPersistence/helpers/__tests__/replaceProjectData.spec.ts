import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockLogger,
    mockBatchStoreUpdates,
    mockGetAudioContext,
    mockImportCachedAudioBuffers,
    mockPrepareCachedAudioBuffersFromIdb,
    mockResetAudioGraph,
    mockClearUndoHistory,
    mockCompactProject,
    mockProjectActionHistoryToStore,
    mockResetCrdtProjectAuthority,
    mockStartCrdtAutoSave,
    mockClearLoadedExternalPlugins,
    mockEnsureTrackStrips,
    mockStopPlayback,
    mockNotifyUser,
    mockProjectStore,
    mockAutoSaveHandle,
    mockStopActiveAutoSave,
    mockHydrateArrangement,
    mockHydrateModuleStores,
    mockResetModuleStores,
    mockVerifyAudioBufferReferences,
} = vi.hoisted(() => ({
    mockLogger: { error: vi.fn(), warn: vi.fn() },
    mockBatchStoreUpdates: vi.fn((fn: () => void) => fn()),
    mockGetAudioContext: vi.fn(() => ({ sampleRate: 44100 })),
    mockImportCachedAudioBuffers: vi.fn(() =>
        Promise.resolve({ publish: vi.fn(), persist: () => Promise.resolve(true) })
    ),
    mockPrepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    mockResetAudioGraph: vi.fn(),
    mockClearUndoHistory: vi.fn(),
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockProjectActionHistoryToStore: vi.fn(),
    mockResetCrdtProjectAuthority: vi.fn(),
    mockStartCrdtAutoSave: vi.fn(() => 'auto-save-handle'),
    mockClearLoadedExternalPlugins: vi.fn(),
    mockEnsureTrackStrips: vi.fn(),
    mockStopPlayback: vi.fn(() => Promise.resolve()),
    mockNotifyUser: vi.fn(),
    mockProjectStore: {
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
    getAudioContext: mockGetAudioContext,
    importCachedAudioBuffers: mockImportCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb: mockPrepareCachedAudioBuffersFromIdb,
    resetAudioGraph: mockResetAudioGraph,
}));
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: mockClearUndoHistory }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject: mockCompactProject,
    projectActionHistoryToStore: mockProjectActionHistoryToStore,
    resetCrdtProjectAuthority: mockResetCrdtProjectAuthority,
    startCrdtAutoSave: mockStartCrdtAutoSave,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ clearLoadedExternalPlugins: mockClearLoadedExternalPlugins }));
vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mockEnsureTrackStrips,
    stopPlayback: mockStopPlayback,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('../../../../stores/projectStore', () => ({ projectStore: mockProjectStore }));
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

import { replaceProjectData } from '../replaceProjectData';

import type { HydratableProjectData } from '../isHydratableProjectData';
import type { ProjectLoadTransaction } from '../runProjectLoadTransaction';

function makeData(): HydratableProjectData {
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
        arrangement: { tracks: [] },
    };
}

function makeTransaction(overrides: Partial<ProjectLoadTransaction> = {}): ProjectLoadTransaction {
    return {
        prepare: () => Promise.resolve(true),
        activate: () => true,
        canActivate: () => true,
        isCurrent: () => true,
        ...overrides,
    };
}

describe('replaceProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockProjectStore.value = null;
        mockImportCachedAudioBuffers.mockResolvedValue({ publish: vi.fn(), persist: () => Promise.resolve(true) });
        mockPrepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: vi.fn() });
        mockStopPlayback.mockResolvedValue(undefined);
        mockCompactProject.mockResolvedValue(undefined);
        mockStartCrdtAutoSave.mockReturnValue('handle');
    });

    it('aborts when transaction.prepare returns false', async () => {
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction({ prepare: () => Promise.resolve(false) }),
        });
        expect(result.status).toBe('aborted');
    });

    it('aborts when transaction.activate returns false', async () => {
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction({ activate: () => false }),
        });
        expect(result.status).toBe('aborted');
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
        const result = await replaceProjectData({
            context: 'loadRecentProject',
            data: makeData(),
            transaction: makeTransaction(),
        });
        expect(result.status).toBe('committed');
        if (result.status === 'committed') {
            expect(result.degraded).toBe(false);
        }
        expect(mockStopPlayback).toHaveBeenCalled();
        expect(mockResetAudioGraph).toHaveBeenCalled();
        // Second argument is the point-of-no-return callback the abort path
        // uses to tell a recoverable failure from an unrecoverable one.
        expect(mockResetCrdtProjectAuthority).toHaveBeenCalledWith('Test Project', expect.any(Function));
        expect(mockResetModuleStores).toHaveBeenCalled();
        expect(mockHydrateArrangement).toHaveBeenCalled();
        expect(mockClearUndoHistory).toHaveBeenCalled();
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
        }
        expect(mockNotifyUser).toHaveBeenCalledWith(
            'Project loaded with recovery errors. Save a new copy before closing.',
            'warning'
        );
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
