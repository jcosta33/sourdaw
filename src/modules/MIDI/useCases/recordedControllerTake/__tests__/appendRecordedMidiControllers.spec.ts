import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreStateInput | null } = { value: null };
    return { state };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.state.value;
        },
        set: vi.fn((next: MidiStoreStateInput | null) => {
            mocks.state.value = next;
        }),
    },
}));

const { appendRecordedMidiControllers } = await import('../appendRecordedMidiControllers');
const { midiStore } = await import('../../../stores/midiStore');
const { createMidiCC, createMidiPitchBend } = await import('../../../models/MidiNote');

describe('appendRecordedMidiControllers', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {
                'clip-1': [{ id: 'cc-existing', controller: 64, value: 127, beat: 1, channel: 0 }],
            },
            pitchBendByClipId: {},
        };
    });

    it('should keep every controller message that shares a beat, channel and controller, after the existing rows', () => {
        const released = createMidiCC(64, 0, 1, 0);
        const pressed = createMidiCC(64, 127, 1, 0);

        appendRecordedMidiControllers({ clipId: 'clip-1', cc: [released, pressed], pitchBend: [] });

        const rows = mocks.state.value?.ccByClipId['clip-1'] ?? [];
        expect(rows.map(({ id }) => id)).toEqual(['cc-existing', released.id, pressed.id]);
        expect(rows.map(({ value }) => value)).toEqual([127, 0, 127]);
    });

    it('should write the controller and pitch-bend rows of a clip in one store write', () => {
        const cc = createMidiCC(1, 10, 0, 2);
        const bendDown = createMidiPitchBend(-8192, 0.5, 2);
        const bendUp = createMidiPitchBend(8191, 0.5, 2);

        appendRecordedMidiControllers({ clipId: 'clip-2', cc: [cc], pitchBend: [bendDown, bendUp] });

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(mocks.state.value?.ccByClipId['clip-2']).toEqual([cc]);
        expect(mocks.state.value?.pitchBendByClipId['clip-2']).toEqual([bendDown, bendUp]);
    });

    it('should land each row under the id it was given, so a snapshot taken before the write names the stored rows', () => {
        const first = createMidiCC(1, 10, 0, 2);
        const second = createMidiCC(1, 10, 0, 2);

        appendRecordedMidiControllers({ clipId: 'clip-2', cc: [first, second], pitchBend: [] });

        expect((mocks.state.value?.ccByClipId['clip-2'] ?? []).map(({ id }) => id)).toEqual([first.id, second.id]);
        expect(first.id).not.toBe(second.id);
    });

    it('should leave the other list of the clip absent when the take recorded none for it', () => {
        appendRecordedMidiControllers({ clipId: 'clip-2', cc: [createMidiCC(1, 10, 0, 2)], pitchBend: [] });

        expect(mocks.state.value?.pitchBendByClipId['clip-2']).toBeUndefined();
    });

    it('should not write when the take recorded nothing', () => {
        appendRecordedMidiControllers({ clipId: 'clip-1', cc: [], pitchBend: [] });

        expect(midiStore.set).not.toHaveBeenCalled();
    });

    it('should give the clip an empty note list in the same write as its rows when asked and it has none', () => {
        appendRecordedMidiControllers({
            clipId: 'clip-2',
            cc: [createMidiCC(64, 127, 1, 0)],
            pitchBend: [],
            ensureNoteList: true,
        });

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(mocks.state.value?.notesByClipId['clip-2']).toEqual([]);
        expect(mocks.state.value?.ccByClipId['clip-2']).toHaveLength(1);
    });

    it('should write the empty note list even when the take recorded no rows', () => {
        appendRecordedMidiControllers({ clipId: 'clip-2', cc: [], pitchBend: [], ensureNoteList: true });

        expect(mocks.state.value?.notesByClipId['clip-2']).toEqual([]);
    });

    it('should keep the notes a clip already has when asked for its note list', () => {
        const note = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        mocks.state.value = { ...mocks.state.value!, notesByClipId: { 'clip-1': [note] } };

        appendRecordedMidiControllers({
            clipId: 'clip-1',
            cc: [createMidiCC(64, 127, 1, 0)],
            pitchBend: [],
            ensureNoteList: true,
        });

        expect(mocks.state.value?.notesByClipId['clip-1']).toEqual([note]);
    });

    it('should leave the clip without a note list unless asked', () => {
        appendRecordedMidiControllers({ clipId: 'clip-2', cc: [createMidiCC(64, 127, 1, 0)], pitchBend: [] });

        expect(mocks.state.value?.notesByClipId['clip-2']).toBeUndefined();
    });

    it('should be a no-op when MIDI state is unavailable', () => {
        mocks.state.value = null;

        appendRecordedMidiControllers({ clipId: 'clip-1', cc: [createMidiCC(64, 127, 1, 0)], pitchBend: [] });

        expect(midiStore.set).not.toHaveBeenCalled();
    });
});
