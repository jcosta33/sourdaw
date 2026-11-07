import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreStateInput | null } = { value: null };
    return { state };
});

vi.mock('../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.state.value;
        },
        set: vi.fn((next: MidiStoreStateInput | null) => {
            mocks.state.value = next;
        }),
    },
}));

const { appendRecordedMidiCC } = await import('../appendRecordedMidiCC');
const { midiStore } = await import('../../stores/midiStore');

describe('appendRecordedMidiCC', () => {
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

    it('should keep every controller message that shares a beat, channel and controller', () => {
        appendRecordedMidiCC({ clipId: 'clip-1', row: { controller: 64, value: 0, beat: 1, channel: 0 } });
        appendRecordedMidiCC({ clipId: 'clip-1', row: { controller: 64, value: 127, beat: 1, channel: 0 } });

        const rows = mocks.state.value?.ccByClipId['clip-1'] ?? [];
        expect(rows.map(({ controller, value, beat, channel }) => ({ controller, value, beat, channel }))).toEqual([
            { controller: 64, value: 127, beat: 1, channel: 0 },
            { controller: 64, value: 0, beat: 1, channel: 0 },
            { controller: 64, value: 127, beat: 1, channel: 0 },
        ]);
        expect(rows[0]?.id).toBe('cc-existing');
    });

    it('should give each appended row its own fresh id', () => {
        appendRecordedMidiCC({ clipId: 'clip-2', row: { controller: 1, value: 10, beat: 0, channel: 2 } });
        appendRecordedMidiCC({ clipId: 'clip-2', row: { controller: 1, value: 10, beat: 0, channel: 2 } });

        const [first, second] = mocks.state.value?.ccByClipId['clip-2'] ?? [];
        expect(first?.id).toEqual(expect.any(String));
        expect(second?.id).toEqual(expect.any(String));
        expect(first?.id).not.toBe(second?.id);
    });

    it('should refuse a row carrying a non-finite number and leave the store untouched', () => {
        expect(() =>
            appendRecordedMidiCC({
                clipId: 'clip-1',
                row: { controller: 64, value: 127, beat: Number.NaN, channel: 0 },
            })
        ).toThrow();

        expect(midiStore.set).not.toHaveBeenCalled();
    });

    it('should be a no-op when MIDI state is unavailable', () => {
        mocks.state.value = null;

        appendRecordedMidiCC({ clipId: 'clip-1', row: { controller: 64, value: 127, beat: 1, channel: 0 } });

        expect(midiStore.set).not.toHaveBeenCalled();
    });
});
