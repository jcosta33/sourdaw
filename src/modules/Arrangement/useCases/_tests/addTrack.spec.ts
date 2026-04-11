import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { addTrack } from '../addTrack';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn(),
}));

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('addTrack', () => {
    beforeEach(() => {
        vi.mocked(getTrackState).mockReset();
        vi.mocked(setTrackState).mockReset();
    });

    it('should return null and not emit when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(addTrack, { eventBus, getTrackState, setTrackState });

        expect(addTrack({ name: 'Drums', kind: 'audio' })).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append track, update state, and emit track.added', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(addTrack, { eventBus, getTrackState, setTrackState });

        const result = addTrack({ name: 'Lead', kind: 'midi' });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ name: 'Lead', kind: 'midi', trackId: result!.id })
        );
    });
});
