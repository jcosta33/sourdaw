import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trimClipStart } from '../trimClipStart';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('trimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates startBeat and audioOffsetBeats correctly', () => {
        trimClipStart('c1', 2);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updater = mocks.updateClip.mock.calls[0][1];

        const mockClip = { startBeat: 0, endBeat: 10, audioOffsetBeats: 0 };
        const result = updater(mockClip);

        expect(result.startBeat).toBe(2);
        expect(result.audioOffsetBeats).toBe(2);
    });

    it('claps startBeat to zero', () => {
        trimClipStart('c1', -5);
        const updater = mocks.updateClip.mock.calls[0][1];
        const result = updater({ startBeat: 2, endBeat: 10, audioOffsetBeats: 0 });

        expect(result.startBeat).toBe(0);
        expect(result.audioOffsetBeats).toBe(-2);
    });

    it('ignores trim if new start is after endBeat', () => {
        trimClipStart('c1', 15);
        const updater = mocks.updateClip.mock.calls[0][1];
        const mockClip = { startBeat: 0, endBeat: 10 };
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });
});
