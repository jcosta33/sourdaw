import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerPadOn } from '../triggerPadOn';
import { triggerPadOff } from '../triggerPadOff';

const mocks = vi.hoisted(() => ({
    crumbsStoreValue: { value: { instanceId: 'inst1' } },
    padStoreValue: { value: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } },
    crumbsNoteOn: vi.fn(),
    crumbsNoteOff: vi.fn(),
}));

vi.mock('../../../stores/crumbsStore', () => ({
    crumbsStore: { get value() { return mocks.crumbsStoreValue.value; } },
}));

vi.mock('../../../stores/padStore', () => ({
    padStore: { get value() { return mocks.padStoreValue.value; } },
}));

vi.mock('../../../repositories/crumbsBridge', () => ({
    crumbsNoteOn: mocks.crumbsNoteOn,
    crumbsNoteOff: mocks.crumbsNoteOff,
}));

describe('Crumbs Pad Triggering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('triggerPadOn delegates to bridge', async () => {
        await triggerPadOn(0, 127);
        expect(mocks.crumbsNoteOn).toHaveBeenCalledWith('inst1', 60, 127);
    });

    it('triggerPadOff delegates to bridge', async () => {
        await triggerPadOff(1);
        expect(mocks.crumbsNoteOff).toHaveBeenCalledWith('inst1', 62);
    });

    it('bails if pad index invalid', async () => {
        await triggerPadOn(99);
        expect(mocks.crumbsNoteOn).not.toHaveBeenCalled();
    });
});
