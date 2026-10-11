import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import {
    projectLoadEpoch,
    runProjectLoadTransaction,
} from '../../../projectPersistence/helpers/runProjectLoadTransaction';
import { finalizeTemplate } from '../finalizeTemplate';

const mocks = vi.hoisted(() => ({
    addSidechainRoute: vi.fn(),
    ensureTrackStrips: vi.fn(),
    setTrackState: vi.fn(),
    syncArrangement: vi.fn(),
    waitForDevices: vi.fn(),
    notifyUser: vi.fn(),
    cancelPendingAudioBufferImport: vi.fn(),
    leaveCollaborationSession: vi.fn(),
    whenProjectIdentityTransitionDependenciesConfigured: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    setTrackState: mocks.setTrackState,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    reconcileAutoInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    waitForDevices: mocks.waitForDevices,
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    cancelPendingAudioBufferImport: mocks.cancelPendingAudioBufferImport,
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    deactivateTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Routing/useCases', () => ({
    addSidechainRoute: mocks.addSidechainRoute,
    addSidechainRouteSnapshot: vi.fn(),
    ensureBusStrip: vi.fn(),
    getAllSidechainRoutes: vi.fn(),
    getSidechainRoutesForTrack: vi.fn(),
    getSidechainTargetCapability: vi.fn(),
    hydrateSidechainRoutes: vi.fn(),
    removeSend: vi.fn(),
    removeSidechainRoute: vi.fn(),
    removeSidechainRouteSnapshot: vi.fn(),
    restoreSidechainRoutes: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    wireSidechainRoutes: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', () => ({ ensureTrackStrips: mocks.ensureTrackStrips }));
vi.mock('../../../demoProjects/demoUtils/syncArrangement', () => ({ syncArrangement: mocks.syncArrangement }));
vi.mock('../../../projectPersistence/projectIdentityTransitionDependencies', () => ({
    projectIdentityTransitionDependencies: { leaveCollaborationSession: mocks.leaveCollaborationSession },
}));
vi.mock('../../../projectPersistence/whenProjectIdentityTransitionDependenciesConfigured', () => ({
    whenProjectIdentityTransitionDependenciesConfigured: mocks.whenProjectIdentityTransitionDependenciesConfigured,
}));

describe('finalizeTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('commits sidechain truth before yielding for device readiness', async () => {
        const readiness = Promise.withResolvers<{ status: 'ready'; devices: [] }>();
        mocks.waitForDevices.mockReturnValue(readiness.promise);
        const trigger = createTrack({ id: 'trigger', name: 'Trigger', kind: 'audio' });
        const target = createTrack({ id: 'target', name: 'Target', kind: 'audio' });

        const completion = finalizeTemplate({
            tracks: [trigger, target],
            sidechainRoutes: [{ trigger, target, deviceId: 'compressor' }],
        });

        expect(mocks.addSidechainRoute).toHaveBeenCalledWith('trigger', 'target', 'compressor', 'sc-comp-threshold');
        readiness.resolve({ status: 'ready', devices: [] });
        await completion;

        expect(mocks.setTrackState).toHaveBeenCalledOnce();
        expect(mocks.addSidechainRoute).toHaveBeenCalledOnce();
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
        expect(mocks.waitForDevices).toHaveBeenCalledOnce();
        expect(mocks.notifyUser).not.toHaveBeenCalled();

        const trackPublicationOrder = mocks.setTrackState.mock.invocationCallOrder[0];
        const sidechainTruthOrder = mocks.addSidechainRoute.mock.invocationCallOrder[0];
        const stripConstructionOrder = mocks.ensureTrackStrips.mock.invocationCallOrder[0];
        const readinessOrder = mocks.waitForDevices.mock.invocationCallOrder[0];
        if (
            trackPublicationOrder === undefined ||
            sidechainTruthOrder === undefined ||
            stripConstructionOrder === undefined ||
            readinessOrder === undefined
        ) {
            throw new Error('expected template publication and runtime readiness calls');
        }
        expect(sidechainTruthOrder).toBeGreaterThan(trackPublicationOrder);
        expect(stripConstructionOrder).toBeGreaterThan(sidechainTruthOrder);
        expect(readinessOrder).toBeGreaterThan(stripConstructionOrder);
    });

    it('keeps committed template truth and reports failed devices without throwing', async () => {
        mocks.whenProjectIdentityTransitionDependenciesConfigured.mockResolvedValue(undefined);
        const currentProject = runProjectLoadTransaction();
        await expect(currentProject.prepare()).resolves.toBe(true);
        expect(currentProject.activate()).toBe(true);
        mocks.waitForDevices.mockResolvedValue({
            status: 'failed',
            devices: [{ deviceId: 'levain-1', status: 'failed', stage: 'content' }],
        });
        const track = createTrack({ id: 'track-1', name: 'Samples', kind: 'midi' });

        await expect(finalizeTemplate({ tracks: [track] })).resolves.toBeUndefined();

        expect(mocks.setTrackState).toHaveBeenCalledOnce();
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('levain-1'), 'warning');
    });

    it('does not report an obsolete cancelled cohort over the current project', async () => {
        mocks.waitForDevices.mockResolvedValue({
            status: 'cancelled',
            devices: [{ deviceId: 'levain-1', status: 'cancelled', stage: null }],
        });

        await finalizeTemplate({ tracks: [] });

        expect(mocks.setTrackState).toHaveBeenCalledOnce();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('does not warn for a failed template cohort after a newer project supersedes it', async () => {
        mocks.whenProjectIdentityTransitionDependenciesConfigured.mockResolvedValue(undefined);
        const readiness = Promise.withResolvers<{
            status: 'failed';
            devices: [{ deviceId: string; status: 'failed'; stage: 'content' }];
        }>();
        mocks.waitForDevices.mockReturnValue(readiness.promise);

        const templateA = runProjectLoadTransaction();
        await expect(templateA.prepare()).resolves.toBe(true);
        expect(templateA.activate()).toBe(true);
        const releaseTemplateA = await projectLoadEpoch.acquireRuntimeTransition();
        const completionA = finalizeTemplate({ tracks: [] });
        const failedReadiness: {
            status: 'failed';
            devices: [{ deviceId: string; status: 'failed'; stage: 'content' }];
        } = {
            status: 'failed',
            devices: [{ deviceId: 'levain-a', status: 'failed', stage: 'content' }],
        };
        let releaseProjectB: Promise<() => void> | null = null;
        try {
            await vi.waitFor(() => expect(mocks.waitForDevices).toHaveBeenCalledOnce());

            const projectB = runProjectLoadTransaction();
            await expect(projectB.prepare()).resolves.toBe(true);
            expect(projectB.activate()).toBe(true);
            let projectBEnteredRuntimeTransition = false;
            releaseProjectB = projectLoadEpoch.acquireRuntimeTransition().then((release) => {
                projectBEnteredRuntimeTransition = true;
                return release;
            });

            expect(templateA.isCurrent()).toBe(false);
            expect(projectB.isCurrent()).toBe(true);

            readiness.resolve(failedReadiness);
            await completionA;

            expect(projectBEnteredRuntimeTransition).toBe(false);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        } finally {
            readiness.resolve(failedReadiness);
            releaseTemplateA();
            if (releaseProjectB) {
                (await releaseProjectB)();
            }
            await completionA;
        }
    });
});
