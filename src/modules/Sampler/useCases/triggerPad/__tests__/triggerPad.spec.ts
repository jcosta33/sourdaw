import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerPadOn } from '../triggerPadOn';
import { triggerPadOff } from '../triggerPadOff';

const mocks = vi.hoisted(() => ({
    samplerStoreValue: { value: { instanceId: 'inst1' } },
    padStoreValue: { value: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } },
    samplerNoteOn: vi.fn(),
    samplerNoteOff: vi.fn(),
}));

vi.mock('../../../stores/samplerStore', () => ({
    samplerStore: { get value() { return mocks.samplerStoreValue.value; } },
}));

vi.mock('../../../stores/padStore', () => ({
    padStore: { get value() { return mocks.padStoreValue.value; } },
}));

vi.mock('../../../repositories/samplerBridge', () => ({
    samplerNoteOn: mocks.samplerNoteOn,
    samplerNoteOff: mocks.samplerNoteOff,
}));

describe('Sampler Pad Triggering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('triggerPadOn delegates to bridge', async () => {
        await triggerPadOn(0, 127);
        expect(mocks.samplerNoteOn).toHaveBeenCalledWith('inst1', 60, 127);
    });

    it('triggerPadOff delegates to bridge', async () => {
        await triggerPadOff(1);
        expect(mocks.samplerNoteOff).toHaveBeenCalledWith('inst1', 62);
    });

    it('bails if pad index invalid', async () => {
        await triggerPadOn(99);
        expect(mocks.samplerNoteOn).not.toHaveBeenCalled();
    });
});
