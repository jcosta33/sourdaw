import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { exportStems, renderOffline } from '../offlineRender';

const offlineRenderMocks = {
    getTrackStoreState: vi.fn(() => null),
    getMidiStoreState: vi.fn(() => null),
    getTransportStoreValue: vi.fn(() => null),
    getTempoMapState: vi.fn(() => null),
    getAutomationLanes: vi.fn(() => []),
    audioBufferCache: { get: vi.fn(() => undefined) },
    buildDeviceChain: vi.fn(async () => []),
    resolveClipsWithComping: vi.fn(() => []),
    beatToSeconds: vi.fn(() => 0),
    resolveDrumKit: vi.fn(() => null),
    scheduleTrackAutomation: vi.fn(),
    scheduleNoteOffline: vi.fn(),
    getSynthParamsFromDevices: vi.fn(() => null),
    scheduleKitNote: vi.fn(),
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
};

describe('renderOffline', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('rejects non-positive duration before touching stores', async () => {
        injectDependencies(renderOffline, offlineRenderMocks);
        await expect(renderOffline(0)).rejects.toThrow();
        expect(offlineRenderMocks.getTrackStoreState).not.toHaveBeenCalled();
    });
});

describe('exportStems', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns empty map when track or midi state is missing', async () => {
        injectDependencies(exportStems, offlineRenderMocks);
        const stems = await exportStems(4);
        expect(stems.size).toBe(0);
    });
});
