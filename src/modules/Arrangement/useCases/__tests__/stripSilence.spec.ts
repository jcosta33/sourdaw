import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stripSilence } from '../stripSilence';

const mocks = vi.hoisted(() => ({
    prepareStripSilence: vi.fn(),
    restoreStripSilenceState: vi.fn(),
}));

vi.mock('../prepareStripSilence', () => ({
    prepareStripSilence: mocks.prepareStripSilence,
}));
vi.mock('../restoreStripSilenceState', () => ({
    restoreStripSilenceState: mocks.restoreStripSilenceState,
}));

describe('stripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns false without restoring when no plan can be prepared', () => {
        mocks.prepareStripSilence.mockReturnValue(null);

        const didWrite = stripSilence('clip-1', -30, 0.1);

        expect(mocks.prepareStripSilence).toHaveBeenCalledWith({ clipId: 'clip-1', threshold: -30, minDuration: 0.1 });
        expect(mocks.restoreStripSilenceState).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('publishes the prepared plan and returns the restore result', () => {
        const previous = { trackId: 't1', clips: [], clipOrder: [], clipSatellites: [], clipAutomationLanes: [] };
        const next = { trackId: 't1', clips: [], clipOrder: [], clipSatellites: [], clipAutomationLanes: [] };
        mocks.prepareStripSilence.mockReturnValue({ previous, next, newClipIds: [] });
        mocks.restoreStripSilenceState.mockReturnValue(true);

        const didWrite = stripSilence('clip-1');

        expect(mocks.restoreStripSilenceState).toHaveBeenCalledWith({ expected: previous, replacement: next });
        expect(didWrite).toBe(true);
    });

    it('propagates a rejected restore', () => {
        const previous = { trackId: 't1', clips: [], clipOrder: [], clipSatellites: [], clipAutomationLanes: [] };
        const next = { trackId: 't1', clips: [], clipOrder: [], clipSatellites: [], clipAutomationLanes: [] };
        mocks.prepareStripSilence.mockReturnValue({ previous, next, newClipIds: [] });
        mocks.restoreStripSilenceState.mockReturnValue(false);

        expect(stripSilence('clip-1')).toBe(false);
    });
});
