import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleReference } from '../toggleReference';

const mocks = vi.hoisted(() => ({
    state: {
        referenceActive: false,
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

describe('toggleReference', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { referenceActive: false };
    });

    it('should not write when the control room store is null', () => {
        mocks.state = null;

        toggleReference();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should flip the referenceActive flag', () => {
        toggleReference();

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ referenceActive: true }));
    });
});
