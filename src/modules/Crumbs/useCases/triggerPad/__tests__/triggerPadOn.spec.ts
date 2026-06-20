import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    padStoreValue: {
        value: { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } } as Record<
            string,
            { pads: Array<{ midiNote: number }> }
        > | null,
    },
    crumbsNoteOn: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../../stores/padStore', () => ({
    padStore: {
        get value() {
            return mocks.padStoreValue.value;
        },
    },
}));

vi.mock('../../../repositories/crumbsBridge', () => ({
    crumbsNoteOn: mocks.crumbsNoteOn,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

import { triggerPadOn } from '../triggerPadOn';

describe('triggerPadOn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.padStoreValue.value = { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } };
    });

    it('sends the pad note to the bridge using the resolved midi note', async () => {
        await triggerPadOn('inst1', 1, 90);
        expect(mocks.crumbsNoteOn).toHaveBeenCalledWith('inst1', 62, 90);
    });

    it('defaults velocity to 100 when omitted', async () => {
        await triggerPadOn('inst1', 0);
        expect(mocks.crumbsNoteOn).toHaveBeenCalledWith('inst1', 60, 100);
    });

    it('bails out when the instance has no pad state', async () => {
        await triggerPadOn('missing', 0);
        expect(mocks.crumbsNoteOn).not.toHaveBeenCalled();
    });

    it('bails out when the pad index is out of range', async () => {
        await triggerPadOn('inst1', 99);
        expect(mocks.crumbsNoteOn).not.toHaveBeenCalled();
    });

    it('swallows a bridge error and logs a warning instead of throwing', async () => {
        mocks.crumbsNoteOn.mockRejectedValueOnce(new Error('engine offline'));
        await expect(triggerPadOn('inst1', 0)).resolves.toBeUndefined();
        expect(mocks.warn).toHaveBeenCalledWith('Note trigger failed:', expect.any(Error));
    });
});
