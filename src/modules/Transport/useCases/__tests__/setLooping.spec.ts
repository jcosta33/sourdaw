import { describe, it, expect, vi, beforeEach } from 'vitest';
import { disableLooping } from '../setLooping';
import { defaultTransportState } from '../../models/TransportState';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');

describe('disableLooping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should set isLooping to false when transport state exists', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isLooping: true });

        disableLooping();

        expect(updateTransportState).toHaveBeenCalledWith({ isLooping: false });
    });

    it('should not update when transport state is missing', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        disableLooping();

        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
