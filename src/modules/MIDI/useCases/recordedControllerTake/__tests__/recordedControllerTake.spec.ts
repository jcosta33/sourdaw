import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    midi: { value: null as MidiStoreStateInput | null },
    activeRecordingRef: { current: [] as string[] },
    trackState: { value: null as { tracks: { id: string; clips: { id: string }[] }[] } | null },
    targetTrackId: { value: null as string | null },
    learnState: {
        value: null as {
            isLearning: boolean;
            learningTarget: string | null;
            mappings: { channel: number; cc: number }[];
        } | null,
    },
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

vi.mock('#/modules/ControlSurface/useCases', () => ({
    getMidiLearnState: () => mocks.learnState.value,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => mocks.targetTrackId.value,
}));

const { midiStore } = await import('../../../stores/midiStore');
const { heldPedalState } = await import('../../../repositories/webMidi/heldPedalState');
const { recordedControllerTakeState } = await import('../../../repositories/webMidi/recordedControllerTakeState');
const { bufferRecordedMidiCC } = await import('../bufferRecordedMidiCC');
const { bufferRecordedMidiPitchBend } = await import('../bufferRecordedMidiPitchBend');
const { beginRecordedControllerTake } = await import('../beginRecordedControllerTake');
const { endRecordedControllerTake } = await import('../endRecordedControllerTake');
const { commitRecordedControllers } = await import('../commitRecordedControllers');
const { discardRecordedControllers } = await import('../discardRecordedControllers');
const { planRecordedControllers } = await import('../planRecordedControllers');

const CLIP = 'rec-clip-1';
const NEXT_CLIP = 'rec-clip-2';
const TRACK = 'track-1';

const bare = <TRow extends { id: string }>(rows: readonly TRow[] | undefined) =>
    (rows ?? []).map(({ id: _id, ...row }) => row);

function holdPedal(channel: number, controller: number, value: number): void {
    const pedals = heldPedalState.get(channel) ?? new Map<number, number>();
    pedals.set(controller, value);
    heldPedalState.set(channel, pedals);
}

function setLiveClips(...clipIds: string[]): void {
    mocks.trackState.value = { tracks: [{ id: TRACK, clips: clipIds.map((id) => ({ id })) }] };
}

/** Begin a take that opened `clipId` on `TRACK`, the live input routed to that track. */
function beginTake(clipId = CLIP): void {
    mocks.activeRecordingRef.current = [clipId];
    mocks.targetTrackId.value = TRACK;
    const liveClipIds = mocks.trackState.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id)) ?? [];
    setLiveClips(...new Set([...liveClipIds, clipId]));
    beginRecordedControllerTake();
}

describe('recorded controller take', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        mocks.midi.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        mocks.activeRecordingRef.current = [];
        mocks.trackState.value = null;
        mocks.targetTrackId.value = null;
        mocks.learnState.value = null;
        heldPedalState.clear();
        recordedControllerTakeState.buffers.clear();
        recordedControllerTakeState.openedClipIds.clear();
        recordedControllerTakeState.committedClipIds.clear();
        recordedControllerTakeState.heldPedalSeeds.clear();
    });

    describe('buffering', () => {
        it('keeps controller and bend rows in arrival order and never touches the store', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 0.5, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 100, beat: 0.5, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 20, beat: 0.5, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: -100, beat: 0.75, channel: 0 } });

            const buffer = recordedControllerTakeState.buffers.get(CLIP);
            expect(bare(buffer?.cc)).toEqual([
                { controller: 1, value: 10, beat: 0.5, channel: 0 },
                { controller: 1, value: 20, beat: 0.5, channel: 0 },
            ]);
            expect(bare(buffer?.pitchBend)).toEqual([
                { value: 100, beat: 0.5, channel: 0 },
                { value: -100, beat: 0.75, channel: 0 },
            ]);
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
            commitRecordedControllers({ clipId: CLIP });

            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 9, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 5, beat: 9, channel: 0 } });

            expect(recordedControllerTakeState.buffers.size).toBe(0);
        });
    });

    describe('planning the commit', () => {
        it('names the rows and ids the commit then writes, and writes nothing itself', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 7, beat: 1, channel: 0 } });

            const plan = planRecordedControllers({ clipId: CLIP });
            const again = planRecordedControllers({ clipId: CLIP });

            expect(midiStore.set).not.toHaveBeenCalled();
            expect(recordedControllerTakeState.buffers.has(CLIP)).toBe(true);
            expect(recordedControllerTakeState.committedClipIds.has(CLIP)).toBe(false);
            expect(again).toEqual(plan);

            commitRecordedControllers({ clipId: CLIP });

            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual(plan.cc);
            expect(mocks.midi.value?.pitchBendByClipId[CLIP]).toEqual(plan.pitchBend);
        });

        it('is empty for a clip with nothing buffered', () => {
            beginTake();

            expect(planRecordedControllers({ clipId: CLIP })).toEqual({ cc: [], pitchBend: [] });
        });
    });

    describe('committing', () => {
        it('writes a clip controller and bend rows in one store write, in arrival order', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 7, beat: 1, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 20, beat: 1, channel: 0 } });

            commitRecordedControllers({ clipId: CLIP });

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

            commitRecordedControllers({ clipId: CLIP });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('drops a clip buffer and starting pedals unwritten when its commit will not land', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            expect(recordedControllerTakeState.heldPedalSeeds.has(CLIP)).toBe(true);

            discardRecordedControllers(CLIP);

            expect(recordedControllerTakeState.buffers.has(CLIP)).toBe(false);
            expect(recordedControllerTakeState.heldPedalSeeds.has(CLIP)).toBe(false);
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

            commitRecordedControllers({ clipId: CLIP });

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

            commitRecordedControllers({ clipId: CLIP });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('adds no duplicate where the take records the controller and channel at beat 0 itself', () => {
            holdPedal(0, 64, 127);
            holdPedal(1, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 0, channel: 0 } });

            commitRecordedControllers({ clipId: CLIP });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 1 },
                { controller: 64, value: 0, beat: 0, channel: 0 },
            ]);
        });

        it('reads the pedals at the take start, not at the commit', () => {
            holdPedal(0, 64, 127);
            beginTake();
            holdPedal(0, 64, 0);

            commitRecordedControllers({ clipId: CLIP });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
            ]);
        });

        it('gives the pedals to the clip the take opened on the input track, once', () => {
            holdPedal(0, 64, 127);
            mocks.activeRecordingRef.current = [CLIP, 'rec-clip-other'];
            mocks.targetTrackId.value = TRACK;
            mocks.trackState.value = {
                tracks: [
                    { id: TRACK, clips: [{ id: CLIP }] },
                    { id: 'track-other', clips: [{ id: 'rec-clip-other' }] },
                ],
            };
            beginRecordedControllerTake();

            commitRecordedControllers({ clipId: 'rec-clip-other' });
            expect(midiStore.set).not.toHaveBeenCalled();

            commitRecordedControllers({ clipId: CLIP });
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toHaveLength(1);

            recordedControllerTakeState.openedClipIds.add('rec-clip-again');
            commitRecordedControllers({ clipId: 'rec-clip-again' });
            expect(mocks.midi.value?.ccByClipId['rec-clip-again']).toBeUndefined();
        });

        it('gives a clip the recorder did not open no pedal row', () => {
            holdPedal(0, 64, 127);
            beginTake();

            commitRecordedControllers({ clipId: 'existing-clip' });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('plans the same pedal rows, ids included, that the commit writes', () => {
            holdPedal(0, 64, 127);
            beginTake();

            const plan = planRecordedControllers({ clipId: CLIP });
            commitRecordedControllers({ clipId: CLIP });

            expect(plan.cc).toHaveLength(1);
            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual(plan.cc);
        });

        it('seeds a pedal no learned mapping owns, and the live route would record', () => {
            holdPedal(0, 64, 127);
            holdPedal(0, 66, 90);
            mocks.learnState.value = { isLearning: false, learningTarget: null, mappings: [{ channel: 0, cc: 64 }] };
            beginTake();

            commitRecordedControllers({ clipId: CLIP });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 66, value: 90, beat: 0, channel: 0 },
            ]);
        });

        it('seeds a pedal on a channel other than the one a mapping owns', () => {
            holdPedal(1, 64, 127);
            mocks.learnState.value = { isLearning: false, learningTarget: null, mappings: [{ channel: 0, cc: 64 }] };
            beginTake();

            commitRecordedControllers({ clipId: CLIP });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 1 },
            ]);
        });

        it('seeds no pedal while MIDI learn is waiting to capture the next controller', () => {
            holdPedal(0, 64, 127);
            mocks.learnState.value = { isLearning: true, learningTarget: 'track-pan', mappings: [] };
            beginTake();

            commitRecordedControllers({ clipId: CLIP });

            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });

    describe('a take that is not committed', () => {
        it('drops the buffer of a recorded clip that was discarded, unwritten', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            setLiveClips();

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

        it('starts the next take empty and with its own pedals once the earlier take was discarded', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            setLiveClips();
            endRecordedControllerTake();

            heldPedalState.clear();
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(NEXT_CLIP);
            beginRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            commitRecordedControllers({ clipId: NEXT_CLIP });
            commitRecordedControllers({ clipId: CLIP });
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('does not let a take whose clip was removed leak into the next take', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            setLiveClips();

            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(NEXT_CLIP);
            beginRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            commitRecordedControllers({ clipId: CLIP });
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('keeps the buffer and pedals of an earlier take whose commit is still waiting when the next take begins', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 55, beat: 1, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 9, beat: 1, channel: 0 } });
            endRecordedControllerTake();

            holdPedal(0, 64, 0);
            holdPedal(0, 66, 33);
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(CLIP, NEXT_CLIP);
            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: NEXT_CLIP, row: { controller: 1, value: 7, beat: 2, channel: 0 } });

            commitRecordedControllers({ clipId: CLIP });
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 1, value: 55, beat: 1, channel: 0 },
            ]);
            expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([{ value: 9, beat: 1, channel: 0 }]);

            commitRecordedControllers({ clipId: NEXT_CLIP });
            expect(bare(mocks.midi.value?.ccByClipId[NEXT_CLIP])).toEqual([
                { controller: 66, value: 33, beat: 0, channel: 0 },
                { controller: 1, value: 7, beat: 2, channel: 0 },
            ]);
        });

        it('lets the next take record into a clip an earlier take already committed', () => {
            beginTake();
            commitRecordedControllers({ clipId: CLIP });

            beginTake(NEXT_CLIP);
            expect(recordedControllerTakeState.committedClipIds.has(CLIP)).toBe(false);
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 4, beat: 1, channel: 0 } });

            expect(recordedControllerTakeState.buffers.get(CLIP)?.cc).toHaveLength(1);
        });

        it('writes the rows a later take records into a carried-over clip after its commit landed, when that take ends', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            endRecordedControllerTake();
            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 127, beat: 2, channel: 0 } });

            commitRecordedControllers({ clipId: CLIP });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 3, channel: 0 } });
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 1, value: 10, beat: 1, channel: 0 },
                { controller: 64, value: 127, beat: 2, channel: 0 },
            ]);
            endRecordedControllerTake();

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 1, value: 10, beat: 1, channel: 0 },
                { controller: 64, value: 127, beat: 2, channel: 0 },
                { controller: 64, value: 0, beat: 3, channel: 0 },
            ]);
        });

        it('writes an overdub take into the existing clip it recorded into when the take ends', () => {
            beginTake();
            setLiveClips(CLIP, 'existing-clip');
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
