import { describe, it, expect, vi } from 'vitest';

import { type TransportState } from '../../../models/TransportState';
import { updateTransportState } from '../updateTransportState';

const mocks = vi.hoisted(() => ({
    updateTransportStateRepo: vi.fn(),
}));

vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: (patch: Partial<TransportState>) => {
        mocks.updateTransportStateRepo(patch);
    },
}));

describe('updateTransportState', () => {
    it('delegates to repository', () => {
        updateTransportState({ isPlaying: true });
        expect(mocks.updateTransportStateRepo).toHaveBeenCalledWith({ isPlaying: true });
    });
});
