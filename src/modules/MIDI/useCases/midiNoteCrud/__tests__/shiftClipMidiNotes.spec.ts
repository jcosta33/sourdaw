import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shiftClipMidiNotes } from '../shiftClipMidiNotes';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
    midiStoreSet: vi.fn(),
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() { return mocks.midiStoreValue.value; },
        set: mocks.midiStoreSet,
    }
}));

describe('shiftClipMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        } as any;
    });

    it('should shift notes, CCs, and pitch bends by the same beat delta', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ startBeat: 0, pitch: 60 }] },
            ccByClipId: { c1: [{ beat: 0, controller: 1, value: 100 }] },
            pitchBendByClipId: { c1: [{ beat: 0, value: 0.5 }] },
        } as any;

        shiftClipMidiNotes('c1', 4);

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(expect.objectContaining({
            notesByClipId: { c1: [{ startBeat: 4, pitch: 60 }] },
            ccByClipId: { c1: [{ beat: 4, controller: 1, value: 100 }] },
            pitchBendByClipId: { c1: [{ beat: 4, value: 0.5 }] },
        }));
    });

    it('should not call set when the clip has no MIDI data', () => {
        shiftClipMidiNotes('missing', 10);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('should not call set when the MIDI store is null', () => {
        mocks.midiStoreValue.value = null as any;
        shiftClipMidiNotes('c1', 1);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });
});
