import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTrack } from '#/modules/Arrangement/useCases';
import { addDeviceToStrip, getTrackStrip } from '#/modules/AudioEngine/useCases';

import { createGrandBouleTrack } from '../createGrandBouleTrack';

type Track = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    devices: Array<{
        id: string;
        name: string;
        type: string;
        bypassed: boolean;
        parameterValues: Record<string, number>;
    }>;
};
const mocks = vi.hoisted(() => ({
    trackStoreValue: null as unknown,
    appendTrack: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
    appendTrack: mocks.appendTrack,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    createTrack: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    addDeviceToStrip: vi.fn(),
    getTrackStrip: vi.fn(),
}));

/** Build a minimal strip whose deviceNodes report the given device ids. */
function stripWithDevices(deviceIds: string[]): ReturnType<typeof getTrackStrip> {
    return { deviceNodes: deviceIds.map((deviceId) => ({ deviceId })) } as ReturnType<typeof getTrackStrip>;
}

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('createGrandBouleTrack', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.appendTrack.mockReset();
        mocks.warn.mockReset();
        vi.mocked(createTrack).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
        vi.mocked(getTrackStrip).mockReset();
    });

    it('should return null when track store is not ready', () => {
        mocks.trackStoreValue = null;

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        expect(createGrandBouleTrack()).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should create track, wire device, emit track.added, and return track id', () => {
        const mockTrack = {
            id: 'track-gb',
            name: 'Grand Boule',
            kind: 'midi' as const,
            devices: [] as Track['devices'],
        } as Track;

        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
        vi.mocked(createTrack).mockReturnValue(mockTrack);
        // The strip reports the exact device id that was wired in.
        vi.mocked(addDeviceToStrip).mockImplementation((_trackId, deviceId) => {
            vi.mocked(getTrackStrip).mockReturnValue(stripWithDevices([deviceId]));
        });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        expect(id).toBe('track-gb');
        expect(mocks.appendTrack).toHaveBeenCalledWith(mockTrack);
        expect(addDeviceToStrip).toHaveBeenCalledWith(
            'track-gb',
            expect.stringMatching(/^grand-boule-/),
            'grand-boule'
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ trackId: 'track-gb', name: 'Grand Boule', kind: 'midi' })
        );
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    // Regression: prior #54/#55 — a failed strip wiring still announced a
    // fully-wired track via track.added.
    it('does not emit track.added when the device fails to wire into the strip', () => {
        const mockTrack = {
            id: 'track-gb',
            name: 'Grand Boule',
            kind: 'midi' as const,
            devices: [] as Track['devices'],
        } as Track;

        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
        vi.mocked(createTrack).mockReturnValue(mockTrack);
        // addDeviceToStrip is a no-op (fallback mode / missing strip): the
        // device never lands in deviceNodes.
        vi.mocked(getTrackStrip).mockReturnValue(stripWithDevices([]));

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        // The track is still created in the arrangement, so the id is returned.
        expect(id).toBe('track-gb');
        expect(mocks.appendTrack).toHaveBeenCalledWith(mockTrack);
        // But the false "fully wired" announcement must be suppressed.
        expect(eventBus.emit).not.toHaveBeenCalledWith('track.added', expect.anything());
        expect(mocks.warn).toHaveBeenCalledTimes(1);
    });

    it('does not emit track.added when the strip is missing entirely', () => {
        const mockTrack = {
            id: 'track-gb',
            name: 'Grand Boule',
            kind: 'midi' as const,
            devices: [] as Track['devices'],
        } as Track;

        mocks.trackStoreValue = { tracks: [], selectedTrackId: null };
        vi.mocked(createTrack).mockReturnValue(mockTrack);
        vi.mocked(getTrackStrip).mockReturnValue(undefined);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        expect(id).toBe('track-gb');
        expect(eventBus.emit).not.toHaveBeenCalledWith('track.added', expect.anything());
        expect(mocks.warn).toHaveBeenCalledTimes(1);
    });
});
