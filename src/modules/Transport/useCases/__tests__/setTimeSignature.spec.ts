import { describe, it, expect, vi } from 'vitest';

import { defaultTransportState } from '../../models/TransportState';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { setTimeSignature } from '../setTimeSignature';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');

describe('setTimeSignature', () => {
    it('should ignore invalid numerator or denominator', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setTimeSignature(0, 4);
        setTimeSignature(4, 3);

        expect(updateTransportState).not.toHaveBeenCalled();
    });

    it('should update numerator and denominator when valid', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });

        setTimeSignature(6, 8);

        expect(updateTransportState).toHaveBeenCalledWith({
            timeSignatureNumerator: 6,
            timeSignatureDenominator: 8,
        });
    });
});
