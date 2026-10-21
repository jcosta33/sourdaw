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

const bareCc = ({
    controller,
    value,
    beat,
    channel,
}: {
    controller: number;
    value: number;
    beat: number;
    channel: number;
}) => ({
    controller,
    value,
    beat,
    channel,
});

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

    it('should keep every controller message that shares a beat, channel and controller', () => {
        appendRecordedMidiControllers({
            clipId: 'clip-1',
            cc: [
                { controller: 64, value: 0, beat: 1, channel: 0 },
                { controller: 64, value: 127, beat: 1, channel: 0 },
            ],
            pitchBend: [],
        });

        const rows = mocks.state.value?.ccByClipId['clip-1'] ?? [];
        expect(rows.map(bareCc)).toEqual([
            { controller: 64, value: 127, beat: 1, channel: 0 },
            { controller: 64, value: 0, beat: 1, channel: 0 },
            { controller: 64, value: 127, beat: 1, channel: 0 },
        ]);
        expect(rows[0]?.id).toBe('cc-existing');
    });

    it('should write the controller and pitch-bend rows of a clip in one store write', () => {
        appendRecordedMidiControllers({
            clipId: 'clip-2',
            cc: [{ controller: 1, value: 10, beat: 0, channel: 2 }],
            pitchBend: [
                { value: -8192, beat: 0.5, channel: 2 },
                { value: 8191, beat: 0.5, channel: 2 },
            ],
        });

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect((mocks.state.value?.ccByClipId['clip-2'] ?? []).map(bareCc)).toEqual([
            { controller: 1, value: 10, beat: 0, channel: 2 },
        ]);
        expect(
            (mocks.state.value?.pitchBendByClipId['clip-2'] ?? []).map(({ value, beat, channel }) => ({
                value,
                beat,
                channel,
            }))
        ).toEqual([
            { value: -8192, beat: 0.5, channel: 2 },
            { value: 8191, beat: 0.5, channel: 2 },
        ]);
    });

    it('should give each appended row its own fresh id', () => {
        appendRecordedMidiControllers({
            clipId: 'clip-2',
            cc: [
                { controller: 1, value: 10, beat: 0, channel: 2 },
                { controller: 1, value: 10, beat: 0, channel: 2 },
            ],
            pitchBend: [],
        });

        const [first, second] = mocks.state.value?.ccByClipId['clip-2'] ?? [];
        expect(first?.id).toEqual(expect.any(String));
        expect(second?.id).toEqual(expect.any(String));
        expect(first?.id).not.toBe(second?.id);
    });

    it('should leave the other list of the clip absent when the take recorded none for it', () => {
        appendRecordedMidiControllers({
            clipId: 'clip-2',
            cc: [{ controller: 1, value: 10, beat: 0, channel: 2 }],
            pitchBend: [],
        });

        expect(mocks.state.value?.pitchBendByClipId['clip-2']).toBeUndefined();
    });

    it('should not write when the take recorded nothing', () => {
        appendRecordedMidiControllers({ clipId: 'clip-1', cc: [], pitchBend: [] });

        expect(midiStore.set).not.toHaveBeenCalled();
    });

    it('should be a no-op when MIDI state is unavailable', () => {
        mocks.state.value = null;

        appendRecordedMidiControllers({
            clipId: 'clip-1',
            cc: [{ controller: 64, value: 127, beat: 1, channel: 0 }],
            pitchBend: [],
        });

        expect(midiStore.set).not.toHaveBeenCalled();
    });
});
