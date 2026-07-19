import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    padStoreValue: {
        value: { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } },
    },
    crumbsNoteOff: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../../stores/padStore', () => ({
    padStore: {
        get value() {
            return mocks.padStoreValue.value;
        },
    },
}));

vi.mock('../../../repositories/crumbsBridge/crumbsNoteOff', () => ({
    crumbsNoteOff: mocks.crumbsNoteOff,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

import { triggerPadOff } from '../triggerPadOff';

describe('triggerPadOff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.padStoreValue.value = { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } };
    });

    it('releases the pad note on the bridge using the resolved midi note', async () => {
        await triggerPadOff('inst1', 1);
        expect(mocks.crumbsNoteOff).toHaveBeenCalledWith('inst1', 62);
    });

    it('bails out when the instance has no pad state', async () => {
        await triggerPadOff('missing', 0);
        expect(mocks.crumbsNoteOff).not.toHaveBeenCalled();
    });

    it('bails out when the pad index is out of range', async () => {
        await triggerPadOff('inst1', 99);
        expect(mocks.crumbsNoteOff).not.toHaveBeenCalled();
    });

    it('swallows a bridge error and logs a warning instead of throwing', async () => {
        mocks.crumbsNoteOff.mockRejectedValueOnce(new Error('engine offline'));
        await expect(triggerPadOff('inst1', 0)).resolves.toBeUndefined();
        expect(mocks.warn).toHaveBeenCalledWith('Note release failed:', expect.any(Error));
    });
});
