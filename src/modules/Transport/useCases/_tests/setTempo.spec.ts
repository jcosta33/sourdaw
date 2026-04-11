import { describe, it, expect, vi } from 'vitest';
import { setTempo } from '../setTempo';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { defaultTransportState } from '../../models/TransportState';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');

describe('setTempo', () => {
    it('should throw when bpm is out of range', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        expect(() => setTempo(10)).toThrow();
        expect(() => setTempo(400)).toThrow();
        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should patch tempo when bpm is valid', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setTempo(140);

        expect(updateTransportState).toHaveBeenCalledWith({ tempo: 140 });
    });
});
