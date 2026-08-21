import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../models/TransportState';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { MAX_MASTER_GAIN } from '../../stores/transportStore';
import { replaceMasterGain } from '../replaceMasterGain';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');

describe('replaceMasterGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState });
    });

    it('replaces an exact expected value in durable percent units', () => {
        expect(replaceMasterGain({ expectedPercent: 80, replacementPercent: 65 })).toBe(true);

        expect(updateTransportState).toHaveBeenCalledWith({ masterGain: 65 });
    });

    it('matches durable percent values without normalized floating-point drift', () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, masterGain: 29 });

        expect(replaceMasterGain({ expectedPercent: 29, replacementPercent: 65 })).toBe(true);

        expect(updateTransportState).toHaveBeenCalledWith({ masterGain: 65 });
    });

    it('accepts a replacement above unity, up to the master fader ceiling', () => {
        expect(replaceMasterGain({ expectedPercent: 80, replacementPercent: 150 })).toBe(true);

        expect(updateTransportState).toHaveBeenCalledWith({ masterGain: 150 });
    });

    it('rejects stale, no-op, missing, or out-of-range writes', () => {
        expect(replaceMasterGain({ expectedPercent: 70, replacementPercent: 65 })).toBe(false);
        expect(replaceMasterGain({ expectedPercent: 80, replacementPercent: 80 })).toBe(false);
        expect(replaceMasterGain({ expectedPercent: 80, replacementPercent: MAX_MASTER_GAIN + 0.01 })).toBe(false);
        vi.mocked(getTransportState).mockReturnValue(null);
        expect(replaceMasterGain({ expectedPercent: 80, replacementPercent: 65 })).toBe(false);

        expect(updateTransportState).not.toHaveBeenCalled();
    });
});
