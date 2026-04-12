import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trimClipEnd } from '../trimClipEnd';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('trimClipEnd', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates endBeat', () => {
        trimClipEnd('c1', 15);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updater = mocks.updateClip.mock.calls[0][1];

        const mockClip = { startBeat: 10, endBeat: 12 };
        const result = updater(mockClip);

        expect(result.endBeat).toBe(15);
    });

    it('ignores if new end is before startBeat', () => {
        trimClipEnd('c1', 5);
        const updater = mocks.updateClip.mock.calls[0][1];
        const mockClip = { startBeat: 10, endBeat: 12 };
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });
});
