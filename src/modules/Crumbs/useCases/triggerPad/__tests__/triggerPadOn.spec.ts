import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
    const padStoreValue: { value: Record<string, { pads: Array<{ midiNote: number }> }> | null } = {
        value: { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } },
    };
    return {
        padStoreValue,
        crumbsNoteOn: vi.fn(),
        padControls: { noteOn: vi.fn(), noteOff: vi.fn() },
        resolvePadControls: vi.fn(),
        warn: vi.fn(),
    };
});

vi.mock('../resolveCrumbsPadControls', () => ({
    resolveCrumbsPadControls: mocks.resolvePadControls,
}));

vi.mock('../../../stores/padStore', () => ({
    padStore: {
        get value() {
            return mocks.padStoreValue.value;
        },
    },
}));

vi.mock('../../../repositories/crumbsBridge/crumbsNoteOn', () => ({
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
        mocks.resolvePadControls.mockReturnValue(mocks.padControls);
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

    // Both carriers, because exactly one of them is audible and which one is
    // not knowable from here: a natively carried strip has its Web Audio twin
    // gated out of the mix, and an uncarried one has no native chain entry for
    // the device at all. Sending only the native slot is what left the pads
    // silent before the first Play (#4204).
    it('voices the Web Audio node as well as the native slot', async () => {
        await triggerPadOn('inst1', 1, 90);

        expect(mocks.padControls.noteOn).toHaveBeenCalledExactlyOnceWith(62, 90);
        expect(mocks.crumbsNoteOn).toHaveBeenCalledExactlyOnceWith('inst1', 62, 90);
    });

    it('voices the Web Audio node even when the native send is refused', async () => {
        mocks.crumbsNoteOn.mockRejectedValueOnce(new Error('engine offline'));

        await triggerPadOn('inst1', 0, 64);

        expect(mocks.padControls.noteOn).toHaveBeenCalledExactlyOnceWith(60, 64);
    });

    it('still sends the native note when no Web Audio node answers', async () => {
        mocks.resolvePadControls.mockReturnValue(null);

        await triggerPadOn('inst1', 0, 64);

        expect(mocks.crumbsNoteOn).toHaveBeenCalledExactlyOnceWith('inst1', 60, 64);
    });

    it('clamps the velocity on both carriers alike', async () => {
        await triggerPadOn('inst1', 0, 500);

        expect(mocks.padControls.noteOn).toHaveBeenCalledExactlyOnceWith(60, 127);
        expect(mocks.crumbsNoteOn).toHaveBeenCalledExactlyOnceWith('inst1', 60, 127);
    });
});
