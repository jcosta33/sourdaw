import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { toggleMono } from '../toggleMono';

const mocks = vi.hoisted((): { state: { monoActive: boolean } | null; set: Mock } => ({
    state: {
        monoActive: false,
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

describe('toggleMono', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { monoActive: false };
    });

    it('should not write when the control room store is null', () => {
        mocks.state = null;

        toggleMono();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should flip the monoActive flag', () => {
        toggleMono();

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ monoActive: true }));
    });
});
