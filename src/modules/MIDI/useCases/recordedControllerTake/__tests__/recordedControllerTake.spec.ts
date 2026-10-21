import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    midi: { value: null as MidiStoreStateInput | null },
    activeRecordingRef: { current: [] as string[] },
    trackState: { value: null as { tracks: { id: string; clips: { id: string }[] }[] } | null },
    targetTrackId: { value: null as string | null },
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midi.value;
        },
        set: vi.fn((next: MidiStoreStateInput | null) => {
            mocks.midi.value = next;
        }),
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
    trackStore: {
        get value() {
            return mocks.trackState.value;
        },
    },
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => mocks.targetTrackId.value,
}));

const { midiStore } = await import('../../../stores/midiStore');
const { channelControllerState } = await import('../../../repositories/webMidi/channelControllerState');
const { recordedControllerTakeState } = await import('../../../repositories/webMidi/recordedControllerTakeState');
const { createMidiChannelControllerState } = await import('../../../models/MidiControllerState');
const { bufferRecordedMidiCC } = await import('../bufferRecordedMidiCC');
const { bufferRecordedMidiPitchBend } = await import('../bufferRecordedMidiPitchBend');
const { beginRecordedControllerTake } = await import('../beginRecordedControllerTake');
const { endRecordedControllerTake } = await import('../endRecordedControllerTake');
const { flushRecordedControllers } = await import('../flushRecordedControllers');

const CLIP = 'rec-clip-1';
const TRACK = 'track-1';

const bare = <TRow extends { id: string }>(rows: readonly TRow[] | undefined) =>
    (rows ?? []).map(({ id: _id, ...row }) => row);

function holdPedal(channel: number, controller: number, value: number): void {
    const state = channelControllerState.get(channel) ?? createMidiChannelControllerState();
    state.heldPedals.set(controller, value);
    channelControllerState.set(channel, state);
}

/** Begin a take that opened `CLIP` on `TRACK`, the live input routed to that track. */
function beginTake(): void {
    mocks.activeRecordingRef.current = [CLIP];
    mocks.targetTrackId.value = TRACK;
    mocks.trackState.value = { tracks: [{ id: TRACK, clips: [{ id: CLIP }] }] };
    beginRecordedControllerTake();
}

describe('recorded controller take', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        mocks.midi.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        mocks.activeRecordingRef.current = [];
        mocks.trackState.value = null;
        mocks.targetTrackId.value = null;
        channelControllerState.clear();
        recordedControllerTakeState.buffers.clear();
        recordedControllerTakeState.openedClipIds.clear();
        recordedControllerTakeState.committedClipIds.clear();
        recordedControllerTakeState.heldPedalSeed = null;
    });

    describe('buffering', () => {
        it('keeps controller and bend rows in arrival order and never touches the store', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 0.5, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 100, beat: 0.5, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 20, beat: 0.5, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: -100, beat: 0.75, channel: 0 } });

            expect(recordedControllerTakeState.buffers.get(CLIP)).toEqual({
                cc: [
                    { controller: 1, value: 10, beat: 0.5, channel: 0 },
                    { controller: 1, value: 20, beat: 0.5, channel: 0 },
                ],
                pitchBend: [
                    { value: 100, beat: 0.5, channel: 0 },
                    { value: -100, beat: 0.75, channel: 0 },
                ],
            });
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('refuses a row carrying a non-finite number and buffers nothing', () => {
            expect(() =>
                bufferRecordedMidiCC({
                    clipId: CLIP,
                    row: { controller: 64, value: 127, beat: Number.NaN, channel: 0 },
                })
            ).toThrow();
            expect(() =>
                bufferRecordedMidiPitchBend({
                    clipId: CLIP,
                    row: { value: Number.POSITIVE_INFINITY, beat: 0, channel: 0 },
                })
            ).toThrow();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
        });

        it('drops a message arriving after its clip committed', () => {
            beginTake();
            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 9, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 5, beat: 9, channel: 0 } });

            expect(recordedControllerTakeState.buffers.size).toBe(0);
        });
    });

    describe('flushing at the commit', () => {
        it('writes a clip controller and bend rows in one store write, in arrival order', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 7, beat: 1, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 20, beat: 1, channel: 0 } });

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            expect(midiStore.set).toHaveBeenCalledTimes(1);
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 1, value: 10, beat: 1, channel: 0 },
                { controller: 1, value: 20, beat: 1, channel: 0 },
            ]);
            expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([{ value: 7, beat: 1, channel: 0 }]);
            expect(recordedControllerTakeState.buffers.has(CLIP)).toBe(false);
        });

        it('writes nothing for a take that recorded no controller', () => {
            beginTake();

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });

    describe('pedals held when the take begins', () => {
        it('puts each held pedal at clip beat 0 ahead of the take, channel preserved', () => {
            holdPedal(0, 64, 127);
            holdPedal(2, 66, 90);
            holdPedal(2, 67, 1);
            holdPedal(1, 64, 40);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 64, value: 40, beat: 0, channel: 1 },
                { controller: 66, value: 90, beat: 0, channel: 2 },
                { controller: 67, value: 1, beat: 0, channel: 2 },
                { controller: 1, value: 10, beat: 1, channel: 0 },
            ]);
        });

        it('records nothing extra for pedals at rest', () => {
            holdPedal(0, 64, 0);
            holdPedal(0, 66, 0);
            beginTake();

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('adds no duplicate where the take records the controller and channel at beat 0 itself', () => {
            holdPedal(0, 64, 127);
            holdPedal(1, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 0, channel: 0 } });

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 1 },
                { controller: 64, value: 0, beat: 0, channel: 0 },
            ]);
        });

        it('reads the pedals at the take start, not at the commit', () => {
            holdPedal(0, 64, 127);
            beginTake();
            holdPedal(0, 64, 0);

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
            ]);
        });

        it('gives the pedals to the clip on the track the live input records, once', () => {
            holdPedal(0, 64, 127);
            beginTake();
            mocks.activeRecordingRef.current = [CLIP, 'rec-clip-other'];
            recordedControllerTakeState.openedClipIds.add('rec-clip-other');

            flushRecordedControllers({ clipId: 'rec-clip-other', trackId: 'track-other' });
            expect(midiStore.set).not.toHaveBeenCalled();

            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toHaveLength(1);

            recordedControllerTakeState.openedClipIds.add('rec-clip-again');
            flushRecordedControllers({ clipId: 'rec-clip-again', trackId: TRACK });
            expect(mocks.midi.value?.ccByClipId['rec-clip-again']).toBeUndefined();
        });

        it('gives a clip the recorder did not open no pedal row', () => {
            holdPedal(0, 64, 127);
            beginTake();

            flushRecordedControllers({ clipId: 'existing-clip', trackId: TRACK });

            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });

    describe('a take that is not committed', () => {
        it('drops the buffer of a recorded clip that was discarded, unwritten', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            mocks.trackState.value = { tracks: [{ id: TRACK, clips: [] }] };

            endRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('keeps the buffer of a recorded clip that is still waiting for its commit', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });

            endRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.has(CLIP)).toBe(true);
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('starts the next take empty and with its own pedals', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            mocks.trackState.value = { tracks: [{ id: TRACK, clips: [] }] };
            endRecordedControllerTake();

            channelControllerState.clear();
            mocks.activeRecordingRef.current = ['rec-clip-2'];
            mocks.trackState.value = { tracks: [{ id: TRACK, clips: [{ id: 'rec-clip-2' }] }] };
            beginRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            flushRecordedControllers({ clipId: 'rec-clip-2', trackId: TRACK });
            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('does not let a take that never committed leak into the next take', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });

            beginTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            flushRecordedControllers({ clipId: CLIP, trackId: TRACK });
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('writes an overdub take into the existing clip it recorded into when the take ends', () => {
            beginTake();
            mocks.trackState.value = { tracks: [{ id: TRACK, clips: [{ id: CLIP }, { id: 'existing-clip' }] }] };
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: 'existing-clip', row: { value: 9, beat: 3, channel: 0 } });

            endRecordedControllerTake();

            expect(midiStore.set).toHaveBeenCalledTimes(1);
            expect(bare(mocks.midi.value?.ccByClipId['existing-clip'])).toEqual([
                { controller: 1, value: 10, beat: 3, channel: 0 },
            ]);
            expect(bare(mocks.midi.value?.pitchBendByClipId['existing-clip'])).toEqual([
                { value: 9, beat: 3, channel: 0 },
            ]);
        });

        it('drops an overdub buffer whose clip was removed mid-take', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });

            endRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });
});
