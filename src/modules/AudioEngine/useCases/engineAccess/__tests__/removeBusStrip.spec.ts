import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeBusStrip } from '../removeBusStrip';

const mocks = vi.hoisted(() => ({
    engineRemoveBusStrip: vi.fn<(busId: string) => void>(),
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        removeBusStrip: mocks.engineRemoveBusStrip,
    },
}));

describe('removeBusStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the bus id to the engine repository', () => {
        removeBusStrip('bus-1');

        expect(mocks.engineRemoveBusStrip).toHaveBeenCalledTimes(1);
        expect(mocks.engineRemoveBusStrip).toHaveBeenCalledWith('bus-1');
    });
});
