import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<(action: AppAction) => Promise<void>>(),
    midi: { value: null as MidiStoreStateInput | null },
    activeRecordingRef: { current: [] as string[] },
    trackState: {
        value: null as { tracks: { id: string; clips: { id: string; startBeat: number; endBeat: number }[] }[] } | null,
    },
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

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

const { logger } = await import('#/infra/logger/appLogger');
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

/** A clip on the timeline from beat 4 to beat 8: its closing line sits at clip beat 4. */
const spanOf = (id: string) => ({ id, startBeat: 4, endBeat: 8 });

const bare = <TRow extends { id: string }>(rows: readonly TRow[] | undefined) =>
    (rows ?? []).map(({ id: _id, ...row }) => row);

function holdPedal(channel: number, controller: number, value: number): void {
    const pedals = heldPedalState.get(channel) ?? new Map<number, number>();
    pedals.set(controller, value);
    heldPedalState.set(channel, pedals);
}

function setLiveClips(...clipIds: string[]): void {
    mocks.trackState.value = { tracks: [{ id: TRACK, clips: clipIds.map((id) => spanOf(id)) }] };
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
    beforeEach(async () => {
        const { handleAppendOverdubControllers } =
            await import('../../../handlers/overdubControllers/handleAppendOverdubControllers');
        // An overdub pass lands through its app action; run the real handler's write so the
        // specs read the rows the store would hold once the dispatch settles.
        mocks.executeAppAction.mockReset();
        mocks.executeAppAction.mockImplementation((action) => {
            if (action.type === 'appendOverdubControllers') {
                handleAppendOverdubControllers.execute(action);
            }
            return Promise.resolve();
        });
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

        it('keeps the zone-master mark of a bend row, and writes no mark on one without it', () => {
            beginTake();
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 100, beat: 0.5, channel: 0, zoneMaster: true } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 200, beat: 0.75, channel: 1 } });

            expect(bare(recordedControllerTakeState.buffers.get(CLIP)?.pitchBend)).toEqual([
                { value: 100, beat: 0.5, channel: 0, zoneMaster: true },
                { value: 200, beat: 0.75, channel: 1 },
            ]);
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
            commitRecordedControllers({ clip: spanOf(CLIP) });

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

            const plan = planRecordedControllers({ clip: spanOf(CLIP) });
            const again = planRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
            expect(recordedControllerTakeState.buffers.has(CLIP)).toBe(true);
            expect(recordedControllerTakeState.committedClipIds.has(CLIP)).toBe(false);
            expect(again).toEqual(plan);

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual(plan.cc);
            expect(mocks.midi.value?.pitchBendByClipId[CLIP]).toEqual(plan.pitchBend);
        });

        it('is empty for a clip with nothing buffered', () => {
            beginTake();

            expect(planRecordedControllers({ clip: spanOf(CLIP) })).toEqual({ cc: [], pitchBend: [] });
        });
    });

    describe('committing', () => {
        it('writes a clip controller and bend rows in one store write, in arrival order', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 7, beat: 1, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 20, beat: 1, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });

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

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('lands a controller-only take without creating a note list for the clip', () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).toHaveBeenCalledTimes(1);
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toHaveLength(1);
            expect(mocks.midi.value?.notesByClipId[CLIP]).toBeUndefined();
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

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 64, value: 40, beat: 0, channel: 1 },
                { controller: 66, value: 90, beat: 0, channel: 2 },
                // Soft pedal at 1 is below its latch threshold: playback reads it as released, so it is no seed.
                { controller: 1, value: 10, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 1 },
                { controller: 66, value: 0, beat: 4, channel: 2 },
            ]);
        });

        const recordedController = { controller: 1, value: 10, beat: 1, channel: 0 };

        it.each([{ controller: 66 }, { controller: 67 }])(
            'seeds no switch pedal $controller held at 63',
            ({ controller }) => {
                holdPedal(0, controller, 63);
                beginTake();
                bufferRecordedMidiCC({ clipId: CLIP, row: recordedController });

                commitRecordedControllers({ clip: spanOf(CLIP) });

                expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([recordedController]);
            }
        );

        it.each([{ controller: 66 }, { controller: 67 }])(
            'seeds a switch pedal $controller held at 64',
            ({ controller }) => {
                holdPedal(0, controller, 64);
                beginTake();
                bufferRecordedMidiCC({ clipId: CLIP, row: recordedController });

                commitRecordedControllers({ clip: spanOf(CLIP) });

                expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                    { controller, value: 64, beat: 0, channel: 0 },
                    recordedController,
                    { controller, value: 0, beat: 4, channel: 0 },
                ]);
            }
        );

        it('keeps the seed when only a later loop pass lifts the pedal at beat 0', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 127, beat: 2, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 0, channel: 0 } });

            expect(bare(planRecordedControllers({ clip: spanOf(CLIP) }).cc)).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 64, value: 127, beat: 2, channel: 0 },
                { controller: 64, value: 0, beat: 0, channel: 0 },
                // Beat order ends on the press at beat 2, so the clip still closes engaged.
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('reads a wrap from any earlier row of the take, however close to the clip start', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 0.25, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 0, channel: 0 } });

            expect(bare(planRecordedControllers({ clip: spanOf(CLIP) }).cc)).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 1, value: 10, beat: 0.25, channel: 0 },
                { controller: 64, value: 0, beat: 0, channel: 0 },
            ]);
        });

        it('records nothing extra for pedals at rest', () => {
            holdPedal(0, 64, 0);
            holdPedal(0, 66, 0);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('adds no duplicate where the take records the controller and channel at beat 0 itself', () => {
            holdPedal(0, 64, 127);
            holdPedal(1, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 0, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 1 },
                { controller: 64, value: 0, beat: 0, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 1 },
            ]);
        });

        it('keeps the pedal held at the start when the take lifts it later than beat 0', () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 2, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 64, value: 0, beat: 2, channel: 0 },
            ]);
        });

        it('reads the pedals at the take start, not at the commit', () => {
            holdPedal(0, 64, 127);
            beginTake();
            holdPedal(0, 64, 0);

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('gives the pedals to the clip the take opened on the input track, once', () => {
            holdPedal(0, 64, 127);
            mocks.activeRecordingRef.current = ['rec-clip-other', CLIP];
            mocks.targetTrackId.value = TRACK;
            mocks.trackState.value = {
                tracks: [
                    { id: TRACK, clips: [spanOf(CLIP)] },
                    { id: 'track-other', clips: [spanOf('rec-clip-other')] },
                ],
            };
            beginRecordedControllerTake();

            commitRecordedControllers({ clip: spanOf('rec-clip-other') });
            expect(midiStore.set).not.toHaveBeenCalled();

            commitRecordedControllers({ clip: spanOf(CLIP) });
            // The pedal seeded at beat 0 and the lift that ends it.
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toHaveLength(2);

            recordedControllerTakeState.openedClipIds.add('rec-clip-again');
            commitRecordedControllers({ clip: spanOf('rec-clip-again') });
            expect(mocks.midi.value?.ccByClipId['rec-clip-again']).toBeUndefined();
        });

        it('gives a clip the recorder did not open no pedal row', () => {
            holdPedal(0, 64, 127);
            beginTake();

            commitRecordedControllers({ clip: spanOf('existing-clip') });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('plans the same pedal rows, ids included, that the commit writes', () => {
            holdPedal(0, 64, 127);
            beginTake();

            const plan = planRecordedControllers({ clip: spanOf(CLIP) });
            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(plan.cc).toHaveLength(2);
            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual(plan.cc);
        });

        it('seeds a pedal no learned mapping owns, and the live route would record', () => {
            holdPedal(0, 64, 127);
            holdPedal(0, 66, 90);
            mocks.learnState.value = { isLearning: false, learningTarget: null, mappings: [{ channel: 0, cc: 64 }] };
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 66, value: 90, beat: 0, channel: 0 },
                { controller: 66, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('seeds a pedal on a channel other than the one a mapping owns', () => {
            holdPedal(1, 64, 127);
            mocks.learnState.value = { isLearning: false, learningTarget: null, mappings: [{ channel: 0, cc: 64 }] };
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 1 },
                { controller: 64, value: 0, beat: 4, channel: 1 },
            ]);
        });

        it('seeds no pedal while MIDI learn is waiting to capture the next controller', () => {
            holdPedal(0, 64, 127);
            mocks.learnState.value = { isLearning: true, learningTarget: 'track-pan', mappings: [] };
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });

    describe('pedals the take leaves engaged', () => {
        const press = (controller: number, value: number, beat: number, channel = 0): void => {
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller, value, beat, channel } });
        };
        const plannedCc = (input: { clip?: ReturnType<typeof spanOf> } = {}) =>
            bare(planRecordedControllers({ clip: input.clip ?? spanOf(CLIP) }).cc);

        it('closes a sustain left down with a lift on the clip closing line', () => {
            beginTake();
            press(64, 127, 1);

            expect(plannedCc()).toEqual([
                { controller: 64, value: 127, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('adds no lift to a pedal whose last row lifts it', () => {
            beginTake();
            press(64, 127, 1);
            press(64, 0, 2);
            press(66, 127, 1);
            press(66, 63, 2);

            expect(plannedCc()).toEqual([
                { controller: 64, value: 127, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 2, channel: 0 },
                { controller: 66, value: 127, beat: 1, channel: 0 },
                { controller: 66, value: 63, beat: 2, channel: 0 },
            ]);
        });

        it.each([
            { controller: 64, value: 1, engaged: true },
            { controller: 64, value: 0, engaged: false },
            { controller: 66, value: 64, engaged: true },
            { controller: 66, value: 63, engaged: false },
            { controller: 67, value: 64, engaged: true },
            { controller: 67, value: 63, engaged: false },
        ])('reads $controller at $value as engaged: $engaged', ({ controller, value, engaged }) => {
            beginTake();
            press(controller, value, 1);

            expect(plannedCc()).toHaveLength(engaged ? 2 : 1);
        });

        it('lifts each pedal and channel on its own, by the pedal state its last row left', () => {
            beginTake();
            press(64, 127, 1, 0);
            press(64, 127, 1, 1);
            press(64, 0, 2, 1);
            press(1, 100, 2, 0);

            expect(plannedCc()).toEqual([
                { controller: 64, value: 127, beat: 1, channel: 0 },
                { controller: 64, value: 127, beat: 1, channel: 1 },
                { controller: 64, value: 0, beat: 2, channel: 1 },
                { controller: 1, value: 100, beat: 2, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('lifts a pedal on its own when another pedal of the same channel was released after it', () => {
            beginTake();
            press(64, 127, 1);
            press(66, 127, 1);
            press(66, 0, 2);

            expect(plannedCc().at(-1)).toEqual({ controller: 64, value: 0, beat: 4, channel: 0 });
            expect(plannedCc()).toHaveLength(4);
        });

        it('closes a loop take whose last pass lifts early after a press late in the clip', () => {
            beginTake();
            press(64, 127, 3);
            press(64, 0, 1);

            expect(plannedCc()).toEqual([
                { controller: 64, value: 127, beat: 3, channel: 0 },
                { controller: 64, value: 0, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('adds no lift to a loop take whose last row by beat is a lift though a press arrived after it', () => {
            beginTake();
            press(64, 127, 1);
            press(64, 0, 3);
            press(64, 127, 1);

            expect(plannedCc()).toEqual([
                { controller: 64, value: 127, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 3, channel: 0 },
                { controller: 64, value: 127, beat: 1, channel: 0 },
            ]);
        });

        it('lets the row that arrived last decide among rows sharing one beat', () => {
            beginTake();
            press(64, 0, 2);
            press(64, 127, 2);

            expect(plannedCc().at(-1)).toEqual({ controller: 64, value: 0, beat: 4, channel: 0 });
        });

        it('lifts a non-pedal controller never', () => {
            beginTake();
            press(1, 127, 1);
            press(68, 127, 1);

            expect(plannedCc()).toHaveLength(2);
        });

        it('counts the closing line from the clip media origin, not the clip start', () => {
            beginTake();
            press(64, 127, 1);
            const trimmedHead = { ...spanOf(CLIP), midiOffsetBeats: 1 };

            expect(plannedCc({ clip: trimmedHead }).at(-1)).toEqual({ controller: 64, value: 0, beat: 5, channel: 0 });
        });

        it('names the same lift, id included, every time the same rows are planned', () => {
            beginTake();
            press(64, 127, 1);

            const first = planRecordedControllers({ clip: spanOf(CLIP) });
            const second = planRecordedControllers({ clip: spanOf(CLIP) });

            expect(second).toEqual(first);
            expect(new Set(first.cc.map(({ id }) => id)).size).toBe(first.cc.length);
        });

        it('writes the lift of a pedal still down when an overdub take ends, on the clip closing line', async () => {
            beginTake();
            setLiveClips(CLIP, 'existing-clip');
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 64, value: 127, beat: 1, channel: 0 } });

            await endRecordedControllerTake();

            expect(bare(mocks.midi.value?.ccByClipId['existing-clip'])).toEqual([
                { controller: 64, value: 127, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
        });
    });

    describe('a take that is not committed', () => {
        it('drops the buffer of a recorded clip that was discarded, unwritten', async () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            setLiveClips();

            await endRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('keeps the buffer of a recorded clip that is still waiting for its commit', async () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });

            await endRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.has(CLIP)).toBe(true);
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('starts the next take empty and with its own pedals once the earlier take was discarded', async () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            setLiveClips();
            await endRecordedControllerTake();

            heldPedalState.clear();
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(NEXT_CLIP);
            beginRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            commitRecordedControllers({ clip: spanOf(NEXT_CLIP) });
            commitRecordedControllers({ clip: spanOf(CLIP) });
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
            commitRecordedControllers({ clip: spanOf(CLIP) });
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('keeps the buffer and pedals of an earlier take whose commit is still waiting when the next take begins', async () => {
            holdPedal(0, 64, 127);
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 55, beat: 1, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: CLIP, row: { value: 9, beat: 1, channel: 0 } });
            await endRecordedControllerTake();

            holdPedal(0, 64, 0);
            holdPedal(0, 66, 90);
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(CLIP, NEXT_CLIP);
            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: NEXT_CLIP, row: { controller: 1, value: 7, beat: 2, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                { controller: 64, value: 127, beat: 0, channel: 0 },
                { controller: 1, value: 55, beat: 1, channel: 0 },
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ]);
            expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([{ value: 9, beat: 1, channel: 0 }]);

            commitRecordedControllers({ clip: spanOf(NEXT_CLIP) });
            expect(bare(mocks.midi.value?.ccByClipId[NEXT_CLIP])).toEqual([
                { controller: 66, value: 90, beat: 0, channel: 0 },
                { controller: 1, value: 7, beat: 2, channel: 0 },
                { controller: 66, value: 0, beat: 4, channel: 0 },
            ]);
        });

        it('lets the next take record into a clip an earlier take already committed', () => {
            beginTake();
            commitRecordedControllers({ clip: spanOf(CLIP) });

            beginTake(NEXT_CLIP);
            expect(recordedControllerTakeState.committedClipIds.has(CLIP)).toBe(false);
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 4, beat: 1, channel: 0 } });

            expect(recordedControllerTakeState.buffers.get(CLIP)?.cc).toHaveLength(1);
        });

        it('writes the rows a later take records into a carried-over clip after its commit landed, when that take ends', async () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 10, beat: 1, channel: 0 } });
            await endRecordedControllerTake();
            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 127, beat: 2, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 3, channel: 0 } });
            const committed = [
                { controller: 1, value: 10, beat: 1, channel: 0 },
                { controller: 64, value: 127, beat: 2, channel: 0 },
                // The commit closes the pedal it found down on the clip's end.
                { controller: 64, value: 0, beat: 4, channel: 0 },
            ];
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual(committed);
            await endRecordedControllerTake();

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual([
                ...committed,
                { controller: 64, value: 0, beat: 3, channel: 0 },
            ]);
        });

        it('writes an overdub take into the existing clip it recorded into when the take ends', async () => {
            beginTake();
            setLiveClips(CLIP, 'existing-clip');
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: 'existing-clip', row: { value: 9, beat: 3, channel: 0 } });

            await endRecordedControllerTake();

            expect(midiStore.set).toHaveBeenCalledTimes(1);
            expect(bare(mocks.midi.value?.ccByClipId['existing-clip'])).toEqual([
                { controller: 1, value: 10, beat: 3, channel: 0 },
            ]);
            expect(bare(mocks.midi.value?.pitchBendByClipId['existing-clip'])).toEqual([
                { value: 9, beat: 3, channel: 0 },
            ]);
        });

        it('lands every clip the overdub pass recorded into in ONE app action', async () => {
            beginTake();
            setLiveClips(CLIP, 'existing-clip', 'second-clip');
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });
            bufferRecordedMidiPitchBend({ clipId: 'second-clip', row: { value: 9, beat: 3, channel: 0 } });

            await endRecordedControllerTake();

            expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
            const [action] = mocks.executeAppAction.mock.calls[0] ?? [];
            if (action?.type !== 'appendOverdubControllers') {
                throw new Error('expected the overdub rows to be appended by one app action');
            }
            expect(action.payload.clips.map((clip) => clip.clipId)).toEqual(['existing-clip', 'second-clip']);
            expect(action.payload.clips.map((clip) => [clip.cc.length, clip.pitchBend.length])).toEqual([
                [1, 0],
                [0, 1],
            ]);
        });

        it('dispatches nothing for an overdub pass that recorded no rows', async () => {
            beginTake();
            setLiveClips(CLIP, 'existing-clip');

            await endRecordedControllerTake();

            expect(mocks.executeAppAction).not.toHaveBeenCalled();
            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('logs a refused dispatch and settles, so the stop never fails on a controller fault', async () => {
            const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
            mocks.executeAppAction.mockRejectedValueOnce(new Error('refused'));
            beginTake();
            setLiveClips(CLIP, 'existing-clip');
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });

            await expect(endRecordedControllerTake()).resolves.toBeUndefined();

            expect(warn).toHaveBeenCalledWith('[MIDI] Recording the overdub controllers failed:', expect.any(Error));
            warn.mockRestore();
        });

        it('lands the next pass after one that was refused', async () => {
            const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
            mocks.executeAppAction.mockRejectedValueOnce(new Error('refused'));
            beginTake();
            setLiveClips(CLIP, 'existing-clip');
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });
            await endRecordedControllerTake();

            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 20, beat: 3, channel: 0 } });
            await endRecordedControllerTake();

            expect(bare(mocks.midi.value?.ccByClipId['existing-clip'])).toEqual([
                { controller: 1, value: 20, beat: 3, channel: 0 },
            ]);
            warn.mockRestore();
        });

        it('drops an overdub buffer whose clip was removed mid-take', async () => {
            beginTake();
            bufferRecordedMidiCC({ clipId: 'existing-clip', row: { controller: 1, value: 10, beat: 3, channel: 0 } });

            await endRecordedControllerTake();

            expect(recordedControllerTakeState.buffers.size).toBe(0);
            expect(midiStore.set).not.toHaveBeenCalled();
            expect(mocks.executeAppAction).not.toHaveBeenCalled();
        });
    });
});
