import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { toggleTalkback } from '../toggleTalkback';

const mocks = vi.hoisted((): { state: { talkbackActive: boolean } | null; set: Mock } => ({
    state: {
        talkbackActive: false,
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

describe('toggleTalkback', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { talkbackActive: false };
    });

    it('should not write when the control room store is null', () => {
        mocks.state = null;

        toggleTalkback();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should flip the talkbackActive flag', () => {
        toggleTalkback();

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ talkbackActive: true }));
    });
});
