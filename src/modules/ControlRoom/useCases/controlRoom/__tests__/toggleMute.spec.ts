import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { toggleMute } from '../toggleMute';

const mocks = vi.hoisted((): { state: { muted: boolean } | null; set: Mock } => ({
    state: {
        muted: false,
    },
    set: vi.fn(),
}));

vi.mock('../../../stores/controlRoom', () => ({
    controlRoomStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

describe('toggleMute', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { muted: false };
    });

    it('should not write when the control room store is null', () => {
        mocks.state = null;

        toggleMute();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should flip the muted flag', () => {
        toggleMute();

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ muted: true }));
    });
});
