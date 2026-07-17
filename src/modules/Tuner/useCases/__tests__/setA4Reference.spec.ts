import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/scoringStore', () => ({
    mergeDeviceState: vi.fn(),
}));

import { mergeDeviceState } from '../../stores/scoringStore';
import { setA4Reference } from '../setA4Reference';

describe('setA4Reference', () => {
    beforeEach(() => {
        vi.mocked(mergeDeviceState).mockClear();
    });

    it('merges the new A4 reference for the given device', () => {
        setA4Reference('d1', 442);

        expect(mergeDeviceState).toHaveBeenCalledWith('d1', { a4Reference: 442 });
    });
});
