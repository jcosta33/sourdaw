import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/tunerStore', () => ({
    mergeDeviceState: vi.fn(),
}));

import { mergeDeviceState } from '../../stores/tunerStore';
import { setDisplayMode } from '../setDisplayMode';

describe('setDisplayMode', () => {
    beforeEach(() => {
        vi.mocked(mergeDeviceState).mockClear();
    });

    it('merges the new display mode for the given device', () => {
        // 'strobe' is a real DisplayMode member; a non-DisplayMode string would be
        // rejected by the use-case signature.
        setDisplayMode('d1', 'strobe');

        expect(mergeDeviceState).toHaveBeenCalledWith('d1', { mode: 'strobe' });
    });
});
