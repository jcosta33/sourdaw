import { describe, it, expect, vi, beforeEach } from 'vitest';

const findToasterControls = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { findToasterControls },
}));

import { getToasterDeviceControls } from '../getToasterDeviceControls';

describe('getToasterDeviceControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to the engine lookup keyed by deviceId and returns its result', () => {
        const controls = { setParam: vi.fn(), setPadParam: vi.fn() };
        findToasterControls.mockReturnValue(controls);

        expect(getToasterDeviceControls('toast-1')).toBe(controls);
        expect(findToasterControls).toHaveBeenCalledWith('toast-1');
    });

    it('returns undefined when the engine has no matching loaded toaster device', () => {
        findToasterControls.mockReturnValue(undefined);

        expect(getToasterDeviceControls('missing')).toBeUndefined();
        expect(findToasterControls).toHaveBeenCalledWith('missing');
    });
});
