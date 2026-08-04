import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addTrackWithDeferredAddedEvent } from '../addTrackWithDeferredAddedEvent';
import { createTrack } from '../createTrack';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn(),
    getTrackById: vi.fn(),
    publishTrackAdded: vi.fn(),
}));

vi.mock('../addTrack', () => ({ addTrack: mocks.addTrack }));
vi.mock('../getTrackById', () => ({ getTrackById: mocks.getTrackById }));
vi.mock('../publishTrackAdded', () => ({ publishTrackAdded: mocks.publishTrackAdded }));

describe('addTrackWithDeferredAddedEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates the track without emitting and publishes the owned event only after commit', async () => {
        const track = createTrack({ name: 'Bass', kind: 'midi' });
        mocks.addTrack.mockReturnValue(track);

        const result = addTrackWithDeferredAddedEvent({ name: 'Bass', kind: 'midi' });

        expect(mocks.addTrack).toHaveBeenCalledWith({
            name: 'Bass',
            kind: 'midi',
            suppressAddedEvent: true,
        });
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();
        if (!result) {
            throw new Error('Expected a deferred track creation result');
        }

        await result.afterCommit();

        expect(mocks.publishTrackAdded).toHaveBeenCalledWith({
            trackId: track.id,
            name: 'Bass',
            kind: 'midi',
        });
    });

    it('publishes after an ambiguous commit only when the track is durable', async () => {
        const track = createTrack({ name: 'Bass', kind: 'midi' });
        mocks.addTrack.mockReturnValue(track);
        mocks.getTrackById.mockReturnValue(undefined);
        const result = addTrackWithDeferredAddedEvent({ name: 'Bass', kind: 'midi' });
        if (!result) {
            throw new Error('Expected a deferred track creation result');
        }

        await result.afterAmbiguousCommit();
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();

        mocks.getTrackById.mockReturnValue(track);
        await result.afterAmbiguousCommit();
        expect(mocks.publishTrackAdded).toHaveBeenCalledTimes(1);
    });

    it('returns null without deferred effects when track creation fails', () => {
        mocks.addTrack.mockReturnValue(null);

        expect(addTrackWithDeferredAddedEvent({ name: 'Bass', kind: 'midi' })).toBeNull();
        expect(mocks.publishTrackAdded).not.toHaveBeenCalled();
    });
});
