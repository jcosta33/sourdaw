import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleMono } from '../toggleMono';

const mocks = vi.hoisted(() => ({
    state: {
        monoActive: false,
    } as { monoActive: boolean } | null,
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
