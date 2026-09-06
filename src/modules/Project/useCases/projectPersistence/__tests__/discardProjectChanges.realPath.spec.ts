import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cancelPendingAudioBufferImport,
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { CURRENT_PROJECT_VERSION } from '../../../models/ProjectData';
import { readNamedProjectJson } from '../../../repositories/project/readNamedProjectJson';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { discardProjectChanges } from '../discardProjectChanges';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

vi.mock('../../../repositories/project/readNamedProjectJson', () => ({ readNamedProjectJson: vi.fn() }));
vi.mock('../../../repositories/project/writeProjectJson', () => ({ writeProjectJson: vi.fn() }));
vi.mock('../../recentProjects/helpers', () => ({ getRecentProjects: () => [] }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
// Discard/reset assertions spy through cancelPendingAudioBufferImport, getAudioContext,
// importCachedAudioBuffers, prepareCachedAudioBuffersFromIdb, and resetAudioGraph; every other
// AudioEngine key in this factory is an unread graph-coverage stub (`vi.fn()` and `audioEngine: {}`).
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({ id: 'audio' })),
    importCachedAudioBuffers: vi.fn(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    resetAudioGraph: vi.fn(),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    clearUndoHistory: vi.fn(),
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
    compactProject: vi.fn(),
    createCrdtDoc: vi.fn(),
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
    replaceCrdtDocInLineage: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
    restoreBranchStateAfterSession: vi.fn(),
    runCrdtPersistenceBarrier: vi.fn(),
    sanitizeIncomingCrdtDocument: vi.fn(),
    setupProjectionBridge: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    subscribeToCrdtChanges: vi.fn(),
    waitForCrdtDocumentTransition: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: vi.fn(),
    activateExternalPlugin: vi.fn(),
    findSupportedPlugin: vi.fn(),
    registerFaustDSP: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', () => ({ ensureTrackStrips: vi.fn(), stopPlayback: vi.fn() }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: vi.fn() }));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: vi.fn() }));
vi.mock('../helpers/hydrateModuleStoresFromProjectData', () => ({ hydrateModuleStoresFromProjectData: vi.fn() }));
vi.mock('../helpers/hydrateArrangementStoreFromProjectData', () => ({
    hydrateArrangementStoreFromProjectData: vi.fn(),
}));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: vi.fn() }));
vi.mock('../helpers/verifyAudioBufferReferences', () => ({ verifyAudioBufferReferences: vi.fn() }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const savedProject = JSON.stringify({
    version: CURRENT_PROJECT_VERSION,
    meta: {
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
        name: 'Saved song',
        createdAt: 10,
        updatedAt: 11,
        keyRoot: 0,
        scaleName: 'major',
        tuning: { name: '12-TET', frequencies: [] },
    },
    arrangement: { tracks: [] },
    audioBuffers: {},
});

describe('discardProjectChanges real load path', () => {
    beforeEach(() => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: 'original-project',
            name: 'Unsaved song',
            createdAt: 10,
            dirty: true,
            loading: false,
            initialized: true,
        });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        vi.mocked(readNamedProjectJson).mockReset();
        vi.mocked(captureProjectRevision).mockReset().mockReturnValue('revision-1');
        vi.mocked(importCachedAudioBuffers)
            .mockReset()
            .mockResolvedValue({ persist: () => Promise.resolve(true), publish: () => 0 });
        vi.mocked(prepareCachedAudioBuffersFromIdb).mockReset();
        vi.mocked(stopPlayback).mockReset().mockResolvedValue(undefined);
        vi.mocked(unloadPlugin).mockReset().mockResolvedValue(undefined);
        vi.mocked(compactProject).mockReset().mockResolvedValue(undefined);
        vi.mocked(resetAudioGraph).mockReset();
        vi.mocked(cancelPendingAudioBufferImport).mockReset();
        vi.mocked(resetActionReplayAuthority).mockReset();
        vi.mocked(clearUndoHistory).mockReset();
        vi.mocked(projectActionHistoryToStore).mockReset();
        vi.mocked(resetCrdtProjectAuthority).mockReset();
        vi.mocked(startCrdtAutoSave).mockReset().mockReturnValue(vi.fn());
        vi.mocked(getAudioContext).mockClear();
    });

    it('does not let replaceProjectData claim loading state mask a later project-store update', async () => {
        let releasePreparation: (() => void) | undefined;
        vi.mocked(readNamedProjectJson).mockResolvedValue(savedProject);
        vi.mocked(prepareCachedAudioBuffersFromIdb).mockImplementation(
            () =>
                new Promise((resolve) => {
                    releasePreparation = () => resolve({ cancel: vi.fn(), publish: () => 0 });
                })
        );

        const discard = discardProjectChanges();
        await vi.waitFor(() => expect(projectStore.value?.loading).toBe(true));
        projectStore.set({ ...projectStore.value!, updatedAt: 12, dirty: true });
        vi.mocked(captureProjectRevision).mockReturnValue('revision-2');
        releasePreparation?.();

        await expect(discard).resolves.toBe(false);
        expect(projectStore.value?.projectId).toBe('original-project');
        expect(projectStore.value?.dirty).toBe(true);
        expect(resetCrdtProjectAuthority).not.toHaveBeenCalled();
    });
});
