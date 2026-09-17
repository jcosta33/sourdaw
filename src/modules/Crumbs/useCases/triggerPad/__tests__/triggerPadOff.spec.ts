import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    padStoreValue: {
        value: { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } },
    },
    crumbsNoteOff: vi.fn(),
    padControls: { noteOn: vi.fn(), noteOff: vi.fn() },
    resolvePadControls: vi.fn(),
    warn: vi.fn(),
}));

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
        mocks.resolvePadControls.mockReturnValue(mocks.padControls);
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

    // The release follows the trigger on both carriers whichever one sounded:
    // a voice left ringing on the silent carrier becomes a stuck note the
    // moment the carrier law flips that strip over.
    it('releases the Web Audio node as well as the native slot', async () => {
        await triggerPadOff('inst1', 1);

        expect(mocks.padControls.noteOff).toHaveBeenCalledExactlyOnceWith(62);
        expect(mocks.crumbsNoteOff).toHaveBeenCalledExactlyOnceWith('inst1', 62);
    });

    it('releases the Web Audio node even when the native send is refused', async () => {
        mocks.crumbsNoteOff.mockRejectedValueOnce(new Error('engine offline'));

        await triggerPadOff('inst1', 0);

        expect(mocks.padControls.noteOff).toHaveBeenCalledExactlyOnceWith(60);
    });

    it('still sends the native release when no Web Audio node answers', async () => {
        mocks.resolvePadControls.mockReturnValue(null);

        await triggerPadOff('inst1', 0);

        expect(mocks.crumbsNoteOff).toHaveBeenCalledExactlyOnceWith('inst1', 60);
    });
});
