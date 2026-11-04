import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    midi: { value: null as MidiStoreStateInput | null },
    activeRecordingRef: { current: [] as string[] },
    trackState: {
        value: null as { tracks: { id: string; clips: { id: string; startBeat: number; endBeat: number }[] }[] } | null,
    },
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
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('#/modules/ControlSurface/useCases', () => ({
    getMidiLearnState: () => null,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => mocks.targetTrackId.value,
}));

const { midiStore } = await import('../../../stores/midiStore');
const { admitPitchBend } = await import('../../../repositories/webMidi/admitPitchBend');
const { channelControllerState } = await import('../../../repositories/webMidi/channelControllerState');
const { channelPitchBendState } = await import('../../../repositories/webMidi/channelPitchBendState');
const { heldPedalState } = await import('../../../repositories/webMidi/heldPedalState');
const { ingestChannelControlChange } = await import('../../../repositories/webMidi/ingestChannelControlChange');
const { recordedControllerTakeState } = await import('../../../repositories/webMidi/recordedControllerTakeState');
const { webMidiRuntime } = await import('../../../repositories/webMidi/state');
const { projectChannelBend } = await import('../../midiClipData/projectChannelBend');
const { beginRecordedControllerTake } = await import('../beginRecordedControllerTake');
const { bufferRecordedMidiPitchBend } = await import('../bufferRecordedMidiPitchBend');
const { commitRecordedControllers } = await import('../commitRecordedControllers');
const { discardRecordedControllers } = await import('../discardRecordedControllers');
const { endRecordedControllerTake } = await import('../endRecordedControllerTake');
const { planRecordedControllers } = await import('../planRecordedControllers');

const CLIP = 'rec-clip-1';
const NEXT_CLIP = 'rec-clip-2';
const TRACK = 'track-1';

/** Zero-based channels: the keyboard's channels 1 and 2, and an MPE member channel. */
const CHANNEL_1 = 0;
const CHANNEL_2 = 1;
const MEMBER_CHANNEL = 3;

/** Wheel positions as the wire sends them (least significant byte first), and the delta each stores. */
const WHEEL_UP = { lsb: 0, msb: 96, delta: 4096 };
const WHEEL_DOWN = { lsb: 0, msb: 32, delta: -4096 };
const CENTRE = { lsb: 0, msb: 64 };

/** A clip on the timeline from beat 4 to beat 8. */
const spanOf = (id: string) => ({ id, startBeat: 4, endBeat: 8 });

const bare = <TRow extends { id: string }>(rows: readonly TRow[] | undefined) =>
    (rows ?? []).map(({ id: _id, ...row }) => row);

function holdWheel(channel: number, wheel: { lsb: number; msb: number }): void {
    admitPitchBend(channel, wheel.lsb, wheel.msb);
}

/** RPN 0 = `semitones` on `channel`, sent to the live input before the take. */
function declareRange(channel: number, semitones: number): void {
    for (const [cc, value] of [
        [101, 0],
        [100, 0],
        [6, semitones],
        [38, 0],
    ]) {
        ingestChannelControlChange({ channel, cc: cc!, value: value! });
    }
}

function recordBend(clipId: string, beat: number, value: number, channel: number): void {
    bufferRecordedMidiPitchBend({ clipId, row: { value, beat, channel, channelScoped: !webMidiRuntime.mpeEnabled } });
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

const storedBends = (clipId = CLIP) => mocks.midi.value?.pitchBendByClipId[clipId];

/** The channel bend stored playback applies to the clip at its timeline position, with its reach and depth. */
function playedBend(clipId = CLIP) {
    return projectChannelBend({
        clips: [
            {
                clip: { startBeat: 4, endBeat: 8 },
                controlChanges: mocks.midi.value?.ccByClipId[clipId] ?? [],
                pitchBends: storedBends(clipId) ?? [],
            },
        ],
        frameAtBeat: (beat) => Math.round(beat * 24_000),
    }).map(({ beat, value, channel, channelScoped, rangeSemitones }) => ({
        beat,
        value,
        channel,
        channelScoped,
        rangeSemitones,
    }));
}

describe('the pitch wheel a keyboard held off centre when a take began', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        mocks.midi.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        mocks.activeRecordingRef.current = [];
        mocks.trackState.value = null;
        mocks.targetTrackId.value = null;
        webMidiRuntime.mpeEnabled = false;
        channelPitchBendState.clear();
        channelControllerState.clear();
        heldPedalState.clear();
        recordedControllerTakeState.buffers.clear();
        recordedControllerTakeState.openedClipIds.clear();
        recordedControllerTakeState.committedClipIds.clear();
        recordedControllerTakeState.carriedOverClips.clear();
        recordedControllerTakeState.heldPedalSeeds.clear();
        recordedControllerTakeState.bendRangeSeeds.clear();
    });

    describe('with MPE off', () => {
        it('leads the take at clip beat 0 with a row scoped to its own channel, so only that channel replays bent', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
            ]);
            // Stored playback moves a scoped row's own channel only: a channel-1 note stays at pitch.
            expect(playedBend()).toEqual([
                { beat: 4, value: WHEEL_UP.delta, channel: CHANNEL_2, channelScoped: true, rangeSemitones: 2 },
            ]);
        });

        it('seeds each off-centre channel on its own, in channel order, ahead of the bends the take records', () => {
            holdWheel(CHANNEL_2, WHEEL_DOWN);
            holdWheel(CHANNEL_1, WHEEL_UP);
            beginTake();
            recordBend(CLIP, 2, 0, CHANNEL_2);

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: CHANNEL_1, channelScoped: true },
                { value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
                { value: 0, beat: 2, channel: CHANNEL_2, channelScoped: true },
            ]);
        });

        it('is read under the bend range the take declares at beat 0', () => {
            declareRange(CHANNEL_2, 12);
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(playedBend()).toEqual([
                { beat: 4, value: WHEEL_UP.delta, channel: CHANNEL_2, channelScoped: true, rangeSemitones: 12 },
            ]);
        });

        it('seeds a member channel when MPE is off, since its wheel then bends the channel', () => {
            holdWheel(MEMBER_CHANNEL, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: MEMBER_CHANNEL, channelScoped: true },
            ]);
        });
    });

    describe('with MPE on', () => {
        it('seeds the zone master wheel as an unscoped row that reaches every member channel', () => {
            webMidiRuntime.mpeEnabled = true;
            holdWheel(CHANNEL_1, WHEEL_DOWN);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([{ value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_1 }]);
            expect(playedBend()).toEqual([
                { beat: 4, value: WHEEL_DOWN.delta, channel: CHANNEL_1, channelScoped: false, rangeSemitones: 2 },
            ]);
        });

        it('seeds only the zone master when the first member channel also holds its wheel off centre', () => {
            webMidiRuntime.mpeEnabled = true;
            holdWheel(CHANNEL_1, WHEEL_DOWN);
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([{ value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_1 }]);
        });

        it('seeds no member channel wheel, whose bend is per-note data the take records on the note', () => {
            webMidiRuntime.mpeEnabled = true;
            holdWheel(MEMBER_CHANNEL, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });

    describe('a bend the take records at beat 0 itself', () => {
        it('stands in for the seed of its channel, with no duplicate', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();
            recordBend(CLIP, 0, WHEEL_DOWN.delta, CHANNEL_2);

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([
                { value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
            ]);
        });

        it('leaves the seed of another channel', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();
            recordBend(CLIP, 0, WHEEL_DOWN.delta, CHANNEL_1);

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
                { value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_1, channelScoped: true },
            ]);
        });

        it('stands in for nothing when it arrives after a row later in the clip, on a later loop pass', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();
            recordBend(CLIP, 2, 0, CHANNEL_2);
            recordBend(CLIP, 0, WHEEL_DOWN.delta, CHANNEL_2);

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(storedBends())).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
                { value: 0, beat: 2, channel: CHANNEL_2, channelScoped: true },
                { value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
            ]);
        });
    });

    it('is the same rows, ids included, in the redo snapshot plan and the write', () => {
        holdWheel(CHANNEL_2, WHEEL_UP);
        beginTake();

        const plan = planRecordedControllers({ clip: spanOf(CLIP) });
        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(plan.pitchBend).toHaveLength(1);
        expect(storedBends()).toEqual(plan.pitchBend);
    });

    it('is read at the take start, not at the commit', () => {
        holdWheel(CHANNEL_2, WHEEL_UP);
        beginTake();
        holdWheel(CHANNEL_2, CENTRE);

        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(storedBends())).toEqual([
            { value: WHEEL_UP.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
        ]);
    });

    describe('seeds nothing', () => {
        it('for wheels at centre, including one moved and returned before the take', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            holdWheel(CHANNEL_2, CENTRE);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for a clip the recorder did not open', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf('existing-clip') });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for a discarded take', () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();

            discardRecordedControllers(CLIP);

            expect(planRecordedControllers({ clip: spanOf(CLIP) }).pitchBend).toEqual([]);
        });

        it('for a take whose clip left the timeline before it ended', async () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();
            setLiveClips();

            await endRecordedControllerTake();

            expect(planRecordedControllers({ clip: spanOf(CLIP) }).pitchBend).toEqual([]);
        });
    });

    describe('when an earlier take is still waiting for its commit', () => {
        it('leaves the carried-over clip its own seed and gives the new clip the wheel in force', async () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();
            const carriedPlan = planRecordedControllers({ clip: spanOf(CLIP) });
            await endRecordedControllerTake();

            holdWheel(CHANNEL_2, WHEEL_DOWN);
            mocks.activeRecordingRef.current = [NEXT_CLIP];
            setLiveClips(CLIP, NEXT_CLIP);
            beginRecordedControllerTake();

            expect(planRecordedControllers({ clip: spanOf(CLIP) })).toEqual(carriedPlan);
            commitRecordedControllers({ clip: spanOf(NEXT_CLIP) });
            expect(bare(storedBends(NEXT_CLIP))).toEqual([
                { value: WHEEL_DOWN.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
            ]);
        });

        it('does not seed again into a carried-over clip the next take records into', async () => {
            holdWheel(CHANNEL_2, WHEEL_UP);
            beginTake();
            const carriedPlan = planRecordedControllers({ clip: spanOf(CLIP) });
            await endRecordedControllerTake();

            holdWheel(CHANNEL_2, WHEEL_DOWN);
            mocks.activeRecordingRef.current = [CLIP];
            beginRecordedControllerTake();

            expect(recordedControllerTakeState.carriedOverClips.has(CLIP)).toBe(true);
            expect(planRecordedControllers({ clip: spanOf(CLIP) })).toEqual(carriedPlan);
            expect(bare(carriedPlan.pitchBend)).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: CHANNEL_2, channelScoped: true },
            ]);
        });
    });
});
