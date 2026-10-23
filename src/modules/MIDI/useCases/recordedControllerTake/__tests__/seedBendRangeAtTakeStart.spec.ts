import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
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

const { midiStore } = await import('../../../stores/midiStore');
const { channelControllerState } = await import('../../../repositories/webMidi/channelControllerState');
const { heldPedalState } = await import('../../../repositories/webMidi/heldPedalState');
const { ingestChannelControlChange } = await import('../../../repositories/webMidi/ingestChannelControlChange');
const { recordedControllerTakeState } = await import('../../../repositories/webMidi/recordedControllerTakeState');
const { webMidiRuntime } = await import('../../../repositories/webMidi/state');
const { createStoredBendRangeReader } = await import('../../midiClipData/createStoredBendRangeReader');
const { beginRecordedControllerTake } = await import('../beginRecordedControllerTake');
const { bufferRecordedMidiCC } = await import('../bufferRecordedMidiCC');
const { bufferRecordedMidiPitchBend } = await import('../bufferRecordedMidiPitchBend');
const { commitRecordedControllers } = await import('../commitRecordedControllers');
const { discardRecordedControllers } = await import('../discardRecordedControllers');
const { endRecordedControllerTake } = await import('../endRecordedControllerTake');
const { planRecordedControllers } = await import('../planRecordedControllers');

const CLIP = 'rec-clip-1';
const NEXT_CLIP = 'rec-clip-2';
const TRACK = 'track-1';

const RPN_MSB = 101;
const RPN_LSB = 100;
const DATA_MSB = 6;
const DATA_LSB = 38;

/** A clip on the timeline from beat 4 to beat 8. */
const spanOf = (id: string) => ({ id, startBeat: 4, endBeat: 8 });

const bare = <TRow extends { id: string }>(rows: readonly TRow[] | undefined) =>
    (rows ?? []).map(({ id: _id, ...row }) => row);

/** Send controller messages to the live input's channel state, as the keyboard does before a take. */
function send(channel: number, ...messages: [controller: number, value: number][]): void {
    for (const [cc, value] of messages) {
        ingestChannelControlChange({ channel, cc, value });
    }
}

/** RPN 0 = `semitones` on `channel`, left selected (no Null RPN). */
function declareRange(channel: number, semitones: number, cents = 0): void {
    send(channel, [RPN_MSB, 0], [RPN_LSB, 0], [DATA_MSB, semitones], [DATA_LSB, cents]);
}

function sendNullRpn(channel: number): void {
    send(channel, [RPN_MSB, 127], [RPN_LSB, 127]);
}

/** Buffer controller messages a take records into `clipId` at `beat` on channel 0, in order. */
function recordCc(clipId: string, beat: number, ...messages: [controller: number, value: number][]): void {
    for (const [controller, value] of messages) {
        bufferRecordedMidiCC({ clipId, row: { controller, value, beat, channel: 0 } });
    }
}

function recordBend(clipId: string, beat: number): void {
    bufferRecordedMidiPitchBend({ clipId, row: { value: 4096, beat, channel: 0 } });
}

function setLiveClips(...clipIds: string[]): void {
    mocks.trackState.value = {
        tracks: [{ id: TRACK, clips: clipIds.map((id) => spanOf(id)) }],
    };
}

function beginTake(clipId = CLIP): void {
    mocks.activeRecordingRef.current = [clipId];
    mocks.targetTrackId.value = TRACK;
    const liveClipIds = mocks.trackState.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id)) ?? [];
    setLiveClips(...new Set([...liveClipIds, clipId]));
    beginRecordedControllerTake();
}

const rangeRows = (channel: number, semitones: number) => [
    { controller: RPN_MSB, value: 0, beat: 0, channel },
    { controller: RPN_LSB, value: 0, beat: 0, channel },
    { controller: DATA_MSB, value: semitones, beat: 0, channel },
    { controller: DATA_LSB, value: 0, beat: 0, channel },
];

describe('the bend range a keyboard declared before a take', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        mocks.midi.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        mocks.activeRecordingRef.current = [];
        mocks.trackState.value = null;
        mocks.targetTrackId.value = null;
        mocks.learnState.value = null;
        webMidiRuntime.mpeEnabled = false;
        channelControllerState.clear();
        heldPedalState.clear();
        recordedControllerTakeState.buffers.clear();
        recordedControllerTakeState.openedClipIds.clear();
        recordedControllerTakeState.committedClipIds.clear();
        recordedControllerTakeState.carriedOverClips.clear();
        recordedControllerTakeState.heldPedalSeeds.clear();
        recordedControllerTakeState.bendRangeSeeds.clear();
    });

    it('leads the take at clip beat 0, and stored playback reads the range at every beat', () => {
        declareRange(0, 12);
        beginTake();

        commitRecordedControllers({ clip: spanOf(CLIP) });

        const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
        expect(bare(rows)).toEqual(rangeRows(0, 12));
        const rangeAt = createStoredBendRangeReader(rows);
        for (const beat of [0, 0.5, 1.5, 3.99]) {
            expect(rangeAt(0, beat)).toBe(12);
        }
    });

    it('keeps the Null RPN the keyboard closed its declaration with, so a later Data Entry stays an ordinary control', () => {
        declareRange(0, 12);
        sendNullRpn(0);
        beginTake();

        commitRecordedControllers({ clip: spanOf(CLIP) });

        const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
        expect(bare(rows)).toEqual([
            ...rangeRows(0, 12),
            { controller: RPN_MSB, value: 127, beat: 0, channel: 0 },
            { controller: RPN_LSB, value: 127, beat: 0, channel: 0 },
        ]);
        expect(createStoredBendRangeReader(rows)(0, 2)).toBe(12);
    });

    it('seeds cents and each channel on its own, in channel order', () => {
        declareRange(2, 24, 50);
        declareRange(1, 7);
        beginTake();

        commitRecordedControllers({ clip: spanOf(CLIP) });

        const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
        expect(bare(rows)).toEqual([
            ...rangeRows(1, 7),
            ...rangeRows(2, 24).map((row) => (row.controller === DATA_LSB ? { ...row, value: 50 } : row)),
        ]);
        const rangeAt = createStoredBendRangeReader(rows);
        expect(rangeAt(1, 1)).toBe(7);
        expect(rangeAt(2, 1)).toBe(24.5);
        expect(rangeAt(0, 1)).toBe(2);
    });

    it('is led by nothing the take records itself, which still overrides the seed', () => {
        declareRange(0, 12);
        beginTake();
        bufferRecordedMidiCC({ clipId: CLIP, row: { controller: RPN_MSB, value: 0, beat: 0, channel: 0 } });
        bufferRecordedMidiCC({ clipId: CLIP, row: { controller: RPN_LSB, value: 0, beat: 0, channel: 0 } });
        bufferRecordedMidiCC({ clipId: CLIP, row: { controller: DATA_MSB, value: 5, beat: 0, channel: 0 } });

        const rows = planRecordedControllers({ clip: spanOf(CLIP) }).cc;

        expect(bare(rows).slice(0, 4)).toEqual(rangeRows(0, 12));
        expect(bare(rows)).toHaveLength(7);
        expect(createStoredBendRangeReader(rows)(0, 1)).toBe(5);
    });

    it('is the same rows, ids included, in the redo snapshot plan and the write', () => {
        declareRange(0, 12);
        beginTake();

        const plan = planRecordedControllers({ clip: spanOf(CLIP) });
        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(plan.cc).toHaveLength(4);
        expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual(plan.cc);
    });

    it('is read at the take start, not at the commit', () => {
        declareRange(0, 12);
        beginTake();
        declareRange(0, 3);

        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual(rangeRows(0, 12));
    });

    describe('seeds nothing', () => {
        it('for a channel that never declared a range', () => {
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for a channel that only received controllers outside the registered-parameter machine', () => {
            send(0, [1, 64], [7, 100]);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for a clip the recorder did not open', () => {
            declareRange(0, 12);
            beginTake();

            commitRecordedControllers({ clip: spanOf('existing-clip') });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('while MIDI learn is waiting to capture the next controller', () => {
            declareRange(0, 12);
            mocks.learnState.value = { isLearning: true, learningTarget: 'param', mappings: [] };
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for an MPE member channel, whose bend is per-note data the take never records as a channel row', () => {
            webMidiRuntime.mpeEnabled = true;
            declareRange(0, 12);
            declareRange(3, 48);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual(rangeRows(0, 12));
        });
    });

    describe('a Data Entry the take records while the keyboard left RPN 0 selected', () => {
        it.each([
            ['no range declared', () => send(0, [RPN_MSB, 0], [RPN_LSB, 0])],
            ['the default range of two semitones', () => declareRange(0, 2)],
        ])('is heard and replayed at the range it set, with %s before the take', (_name, prepare) => {
            prepare();
            beginTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: DATA_MSB, value: 12, beat: 1, channel: 0 } });

            commitRecordedControllers({ clip: spanOf(CLIP) });

            const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
            expect(createStoredBendRangeReader(rows)(0, 2)).toBe(12);
        });
    });

    describe('an overdub into a clip the recorder did not open', () => {
        /** A first take seeded at ±12 on channel 0, with a bend at each of `bendBeats`, committed. */
        const recordFirstTakeAtTwelve = (...bendBeats: number[]) => {
            declareRange(0, 12);
            beginTake();
            for (const beat of bendBeats) {
                recordBend(CLIP, beat);
            }
            commitRecordedControllers({ clip: spanOf(CLIP) });
        };

        function beginOverdub(): void {
            mocks.activeRecordingRef.current = [];
            setLiveClips(CLIP);
            beginRecordedControllerTake();
        }

        function overdubBendAtBeat(beat: number): void {
            beginOverdub();
            recordBend(CLIP, beat);
            endRecordedControllerTake();
        }

        const keyboardBackAtTwo = () => {
            declareRange(0, 2);
            sendNullRpn(0);
        };

        const storedRangesAt = (...beats: number[]) => {
            const rangeAt = createStoredBendRangeReader(mocks.midi.value?.ccByClipId[CLIP] ?? []);
            return beats.map((beat) => rangeAt(0, beat));
        };

        it('returns the earlier take its own state after the overdub, so a Data Entry it recorded later still sets its range', () => {
            beginTake();
            recordCc(CLIP, 0, [RPN_MSB, 0], [RPN_LSB, 0], [DATA_MSB, 12]);
            recordBend(CLIP, 1);
            recordCc(CLIP, 3, [DATA_MSB, 7]);
            recordBend(CLIP, 3.5);
            commitRecordedControllers({ clip: spanOf(CLIP) });
            keyboardBackAtTwo();

            overdubBendAtBeat(2);

            expect(storedRangesAt(1, 2, 3.5)).toEqual([12, 2, 7]);
        });

        it('returns the earlier take its seeded range at its first bend after the overdub', () => {
            recordFirstTakeAtTwelve(1, 3);
            keyboardBackAtTwo();

            overdubBendAtBeat(2);

            expect(storedRangesAt(1, 2, 3)).toEqual([12, 2, 12]);
        });

        it('starts from the state the keyboard held when the take began, and follows what the take itself declares', () => {
            recordFirstTakeAtTwelve();
            keyboardBackAtTwo();
            beginOverdub();
            recordBend(CLIP, 2);
            const declaration: [number, number][] = [
                [RPN_MSB, 0],
                [RPN_LSB, 0],
                [DATA_MSB, 7],
            ];
            send(0, ...declaration);
            recordCc(CLIP, 3, ...declaration);
            recordBend(CLIP, 3.5);
            endRecordedControllerTake();

            expect(storedRangesAt(1, 2, 3.5)).toEqual([12, 2, 7]);
        });

        it('lets a declaration the overdub records on its first state beat win over the state it began in', () => {
            recordFirstTakeAtTwelve();
            keyboardBackAtTwo();
            beginOverdub();
            recordCc(CLIP, 2, [RPN_MSB, 0], [RPN_LSB, 0], [DATA_MSB, 5]);
            recordBend(CLIP, 2.5);
            endRecordedControllerTake();

            expect(storedRangesAt(1, 2, 2.5)).toEqual([12, 5, 5]);
        });

        it('declares the range the keyboard is back at where the overdub starts, and leaves the earlier take its own', () => {
            recordFirstTakeAtTwelve();
            send(0, [RPN_MSB, 0], [RPN_LSB, 0], [DATA_MSB, 2], [DATA_LSB, 0]);
            sendNullRpn(0);

            overdubBendAtBeat(2);

            const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
            const rangeAt = createStoredBendRangeReader(rows);
            expect(rangeAt(0, 2)).toBe(2);
            expect(rangeAt(0, 3)).toBe(2);
            expect(rangeAt(0, 0)).toBe(12);
            expect(rangeAt(0, 1.99)).toBe(12);
            expect(bare(rows).slice(0, 4)).toEqual(rangeRows(0, 12));
            expect(
                bare(rows)
                    .slice(4)
                    .every((row) => row.beat === 2)
            ).toBe(true);
        });

        it('declares nothing when the keyboard is at the range the clip already holds', () => {
            recordFirstTakeAtTwelve(1, 3);
            const rowsBefore = mocks.midi.value?.ccByClipId[CLIP];

            overdubBendAtBeat(2);

            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual(rowsBefore);
            expect(storedRangesAt(1, 2, 3)).toEqual([12, 12, 12]);
        });

        it('declares nothing on a channel the overdub writes no bend or parameter row to', () => {
            recordFirstTakeAtTwelve();
            send(0, [RPN_MSB, 0], [RPN_LSB, 0], [DATA_MSB, 2], [DATA_LSB, 0]);
            sendNullRpn(0);
            mocks.activeRecordingRef.current = [];
            setLiveClips(CLIP);
            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 1, value: 64, beat: 2, channel: 0 } });
            endRecordedControllerTake();

            const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
            expect(bare(rows)).toEqual([...rangeRows(0, 12), { controller: 1, value: 64, beat: 2, channel: 0 }]);
            expect(createStoredBendRangeReader(rows)(0, 3)).toBe(12);
        });
    });

    describe('when an earlier take is still waiting for its commit', () => {
        it('leaves the carried-over clip with its own single declaration and gives the new clip the range in force', () => {
            declareRange(0, 12);
            beginTake();
            const carriedPlan = planRecordedControllers({ clip: spanOf(CLIP) });
            endRecordedControllerTake();

            declareRange(0, 7);
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(CLIP, NEXT_CLIP);
            beginRecordedControllerTake();

            expect(planRecordedControllers({ clip: spanOf(CLIP) })).toEqual(carriedPlan);
            commitRecordedControllers({ clip: spanOf(CLIP) });
            expect(bare(mocks.midi.value?.ccByClipId[CLIP])).toEqual(rangeRows(0, 12));
            commitRecordedControllers({ clip: spanOf(NEXT_CLIP) });
            expect(bare(mocks.midi.value?.ccByClipId[NEXT_CLIP])).toEqual(rangeRows(0, 7));
        });

        it('does not declare again into a carried-over clip the next take records into', () => {
            declareRange(0, 12);
            beginTake();
            const carriedPlan = planRecordedControllers({ clip: spanOf(CLIP) });
            endRecordedControllerTake();

            declareRange(0, 7);
            mocks.activeRecordingRef.current = [CLIP];
            beginRecordedControllerTake();

            expect(recordedControllerTakeState.carriedOverClips.has(CLIP)).toBe(true);
            expect(planRecordedControllers({ clip: spanOf(CLIP) })).toEqual(carriedPlan);
            expect(carriedPlan.cc).toHaveLength(4);
        });

        it('replays each take of a carried-over clip at the state it recorded under', () => {
            declareRange(0, 12);
            beginTake();
            recordBend(CLIP, 1);
            recordBend(CLIP, 3);
            endRecordedControllerTake();

            declareRange(0, 2);
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(CLIP, NEXT_CLIP);
            beginRecordedControllerTake();
            recordBend(CLIP, 2);
            endRecordedControllerTake();

            const plan = planRecordedControllers({ clip: spanOf(CLIP) });
            commitRecordedControllers({ clip: spanOf(CLIP) });

            const rows = mocks.midi.value?.ccByClipId[CLIP] ?? [];
            expect(rows).toEqual(plan.cc);
            const rangeAt = createStoredBendRangeReader(rows);
            expect([1, 2, 3].map((beat) => rangeAt(0, beat))).toEqual([12, 2, 12]);
        });
    });

    it('is dropped with the buffer when its commit will not land', () => {
        declareRange(0, 12);
        beginTake();
        expect(recordedControllerTakeState.bendRangeSeeds.has(CLIP)).toBe(true);

        discardRecordedControllers(CLIP);

        expect(recordedControllerTakeState.bendRangeSeeds.has(CLIP)).toBe(false);
        commitRecordedControllers({ clip: spanOf(CLIP) });
        expect(midiStore.set).not.toHaveBeenCalled();
    });

    it('is dropped with the take when its clip is discarded unwritten', () => {
        declareRange(0, 12);
        beginTake();
        expect(recordedControllerTakeState.bendRangeSeeds.has(CLIP)).toBe(true);

        mocks.trackState.value = { tracks: [{ id: TRACK, clips: [] }] };
        endRecordedControllerTake();

        expect(recordedControllerTakeState.bendRangeSeeds.has(CLIP)).toBe(false);
        expect(midiStore.set).not.toHaveBeenCalled();
    });
});
