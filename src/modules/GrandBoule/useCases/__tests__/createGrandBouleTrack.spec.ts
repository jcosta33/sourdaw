import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { createTrack } from '#/modules/Arrangement/useCases/createTrack';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip';

import { createGrandBouleTrack } from '../createGrandBouleTrack';

const mocks = vi.hoisted(() => ({
    trackStoreValue: null as unknown,
    appendTrack: vi.fn(),
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

vi.mock('#/modules/Arrangement/useCases/createTrack', () => ({
    createTrack: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip', () => ({
    addDeviceToStrip: vi.fn(),
}));

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('createGrandBouleTrack', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.appendTrack.mockReset();
        vi.mocked(createTrack).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
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
    });
});
