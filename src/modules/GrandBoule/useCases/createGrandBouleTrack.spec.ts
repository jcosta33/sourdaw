import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createGrandBouleTrack } from './createGrandBouleTrack';
import { createTrack } from '#/modules/Arrangement/useCases/createTrack';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { setTrackStoreState } from '#/modules/Arrangement/useCases/setTrackStoreState';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip';
import { type Track } from '#/modules/Arrangement/models/Track';

vi.mock('#/modules/Arrangement/useCases/createTrack', () => ({
    createTrack: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases/setTrackStoreState', () => ({
    setTrackStoreState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/deviceControls', () => ({
    addDeviceToStrip: vi.fn(),
}));

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('createGrandBouleTrack', () => {
    beforeEach(() => {
        vi.mocked(createTrack).mockReset();
        vi.mocked(getTrackStoreState).mockReset();
        vi.mocked(setTrackStoreState).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
    });

    it('should return null when track store is not ready', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

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

        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [], selectedTrackId: null });
        vi.mocked(createTrack).mockReturnValue(mockTrack);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createGrandBouleTrack, { eventBus });

        const id = createGrandBouleTrack();

        expect(id).toBe('track-gb');
        expect(setTrackStoreState).toHaveBeenCalled();
        expect(addDeviceToStrip).toHaveBeenCalledWith('track-gb', expect.stringMatching(/^grand-boule-/), 'grand-boule');
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ trackId: 'track-gb', name: 'Grand Boule', kind: 'midi' })
        );
    });
});
