import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { finalizeTemplate } from '../finalizeTemplate';

const mocks = vi.hoisted(() => ({
    addSidechainRoute: vi.fn(),
    ensureTrackStrips: vi.fn(),
    setTrackState: vi.fn(),
    syncArrangement: vi.fn(),
    waitForDevices: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    setTrackState: mocks.setTrackState,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({ waitForDevices: mocks.waitForDevices }));
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

describe('finalizeTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('commits sidechain truth before yielding for device readiness', async () => {
        const readiness = Promise.withResolvers<void>();
        mocks.waitForDevices.mockReturnValue(readiness.promise);
        const trigger = createTrack({ id: 'trigger', name: 'Trigger', kind: 'audio' });
        const target = createTrack({ id: 'target', name: 'Target', kind: 'audio' });

        const completion = finalizeTemplate({
            tracks: [trigger, target],
            sidechainRoutes: [{ trigger, target, deviceId: 'compressor' }],
        });

        expect(mocks.addSidechainRoute).toHaveBeenCalledWith('trigger', 'target', 'compressor', 'sc-comp-threshold');
        readiness.resolve();
        await completion;

        expect(mocks.setTrackState).toHaveBeenCalledOnce();
        expect(mocks.addSidechainRoute).toHaveBeenCalledOnce();
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
        expect(mocks.waitForDevices).toHaveBeenCalledOnce();

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
});
