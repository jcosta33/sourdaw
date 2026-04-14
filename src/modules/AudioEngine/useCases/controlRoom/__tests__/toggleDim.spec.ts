import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleDim } from '../toggleDim';

const mocks = vi.hoisted(() => ({
    state: {
        dimActive: false,
    } as any,
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

describe('toggleDim', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { dimActive: false };
    });

    it('should not write when the control room store is null', () => {
        mocks.state = null;

        toggleDim();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should flip the dimActive flag', () => {
        toggleDim();

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ dimActive: true }));
    });
});
