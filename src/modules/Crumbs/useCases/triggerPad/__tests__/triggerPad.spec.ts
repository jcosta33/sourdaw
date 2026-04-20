import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    padStoreValue: { value: { inst1: { pads: [{ midiNote: 60 }, { midiNote: 62 }] } } as Record<string, { pads: Array<{ midiNote: number }> }> },
    crumbsNoteOn: vi.fn(),
    crumbsNoteOff: vi.fn(),
}));

vi.mock('../../../stores/padStore', () => ({
    padStore: { get value() { return mocks.padStoreValue.value; } },
}));

vi.mock('../../../repositories/crumbsBridge', () => ({
    crumbsNoteOn: mocks.crumbsNoteOn,
    crumbsNoteOff: mocks.crumbsNoteOff,
}));

import { triggerPadOn } from '../triggerPadOn';
import { triggerPadOff } from '../triggerPadOff';

describe('Crumbs Pad Triggering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('triggerPadOn delegates to bridge', async () => {
        await triggerPadOn('inst1', 0, 127);
        expect(mocks.crumbsNoteOn).toHaveBeenCalledWith('inst1', 60, 127);
    });

    it('triggerPadOff delegates to bridge', async () => {
        await triggerPadOff('inst1', 1);
        expect(mocks.crumbsNoteOff).toHaveBeenCalledWith('inst1', 62);
    });

    it('bails if pad index invalid', async () => {
        await triggerPadOn('inst1', 99);
        expect(mocks.crumbsNoteOn).not.toHaveBeenCalled();
    });
});
