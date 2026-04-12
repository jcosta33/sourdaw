import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTransportState } from '../updateTransportState';

const mocks = vi.hoisted(() => ({
    updateTransportStateRepo: vi.fn(),
}));

vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: (patch: any) => mocks.updateTransportStateRepo(patch),
}));

describe('updateTransportState', () => {
    it('delegates to repository', () => {
        updateTransportState({ isPlaying: true });
        expect(mocks.updateTransportStateRepo).toHaveBeenCalledWith({ isPlaying: true });
    });
});
