import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setInputDevice } from '../setInputDevice';

const mocks = vi.hoisted(() => ({
    audioDeviceStoreValue: { value: { selectedInputId: null } },
    audioDeviceStoreSet: vi.fn(),
}));

vi.mock('../helpers', () => ({
    audioDeviceStore: {
        get value() {
            return mocks.audioDeviceStoreValue.value;
        },
        set: mocks.audioDeviceStoreSet,
    },
}));

describe('setInputDevice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates selectedInputId in store', () => {
        mocks.audioDeviceStoreValue.value = { selectedInputId: 'old' } as any;

        setInputDevice('new-mic');

        expect(mocks.audioDeviceStoreSet).toHaveBeenCalledWith({
            selectedInputId: 'new-mic',
        });
    });
});
