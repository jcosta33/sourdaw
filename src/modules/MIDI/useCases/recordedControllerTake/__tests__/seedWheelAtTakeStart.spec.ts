import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    midi: { value: null as MidiStoreStateInput | null },
    activeRecordingRef: { current: [] as string[] },
    trackState: {
        value: null as { tracks: { id: string; clips: { id: string; startBeat: number; endBeat: number }[] }[] } | null,
    },
    targetTrackId: { value: null as string | null },
    dispatched: [] as AppAction[],
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
    getMidiLearnState: () => null,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => mocks.targetTrackId.value,
}));

// An overdub pass lands through its app action; run the real handler's write so the specs read
// the rows the store would hold once the dispatch settles.
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: async (action: AppAction): Promise<void> => {
        mocks.dispatched.push(action);
        const { handleAppendOverdubControllers } =
            await import('../../../handlers/overdubControllers/handleAppendOverdubControllers');
        if (action.type === 'appendOverdubControllers') {
            handleAppendOverdubControllers.execute(action);
        }
    },
}));

const { midiStore } = await import('../../../stores/midiStore');
const { admitPitchBend } = await import('../../../repositories/webMidi/admitPitchBend');
const { admitResetAllControllers } = await import('../../../repositories/webMidi/admitResetAllControllers');
const { channelPitchBendState } = await import('../../../repositories/webMidi/channelPitchBendState');
const { channelControllerState } = await import('../../../repositories/webMidi/channelControllerState');
const { heldPedalState } = await import('../../../repositories/webMidi/heldPedalState');
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
const TRACK = 'track-1';

/** Wheel positions as the wire sends them (least significant byte first): 4096 up, and 4096 down. */
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

function recordBend(clipId: string, beat: number, value: number, channel = 0): void {
    bufferRecordedMidiPitchBend({ clipId, row: { value, beat, channel } });
}

function setLiveClips(...clipIds: string[]): void {
    mocks.trackState.value = {
        tracks: [{ id: TRACK, clips: clipIds.map((id) => spanOf(id)) }],
    };
}

function beginTake(clipId = CLIP): void {
    mocks.activeRecordingRef.current = [clipId];
    mocks.targetTrackId.value = TRACK;
    setLiveClips(clipId);
    beginRecordedControllerTake();
}

/** The channel bend stored playback applies to the clip, as beat and value, at its timeline position. */
function playedBend(pitchBends: readonly { id: string; value: number; beat: number; channel: number }[]) {
    return projectChannelBend({
        clips: [{ clip: { startBeat: 4, endBeat: 8 }, controlChanges: [], pitchBends }],
        frameAtBeat: (beat) => Math.round(beat * 24_000),
    }).map(({ beat, value }) => ({ beat, value }));
}

describe('the pitch wheel a keyboard held when a take began', () => {
    beforeEach(() => {
        mocks.dispatched.length = 0;
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
        recordedControllerTakeState.pitchBendSeeds.clear();
    });

    it('leads the take with one bend row at clip beat 0, so a note struck before the wheel moves replays bent', () => {
        holdWheel(0, WHEEL_UP);
        beginTake();
        recordBend(CLIP, 2, WHEEL_DOWN.delta);

        commitRecordedControllers({ clip: spanOf(CLIP) });

        const rows = mocks.midi.value?.pitchBendByClipId[CLIP];
        expect(bare(rows)).toEqual([
            { value: WHEEL_UP.delta, beat: 0, channel: 0 },
            { value: WHEEL_DOWN.delta, beat: 2, channel: 0 },
        ]);
        expect(playedBend(rows ?? [])).toEqual([
            { beat: 4, value: WHEEL_UP.delta },
            { beat: 6, value: WHEEL_DOWN.delta },
        ]);
    });

    it('is written whether or not the take records a bend of its own', () => {
        holdWheel(0, WHEEL_DOWN);
        beginTake();

        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([
            { value: WHEEL_DOWN.delta, beat: 0, channel: 0 },
        ]);
    });

    it('seeds each held channel on its own, in channel order', () => {
        holdWheel(2, WHEEL_DOWN);
        holdWheel(1, WHEEL_UP);
        beginTake();

        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([
            { value: WHEEL_UP.delta, beat: 0, channel: 1 },
            { value: WHEEL_DOWN.delta, beat: 0, channel: 2 },
        ]);
    });

    it('is the same rows, ids included, in the redo snapshot plan and the write', () => {
        holdWheel(0, WHEEL_UP);
        beginTake();

        const plan = planRecordedControllers({ clip: spanOf(CLIP) });
        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(plan.pitchBend).toHaveLength(1);
        expect(mocks.midi.value?.pitchBendByClipId[CLIP]).toEqual(plan.pitchBend);
    });

    it('is read at the take start, not at the commit', () => {
        holdWheel(0, WHEEL_UP);
        beginTake();
        holdWheel(0, WHEEL_DOWN);

        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([
            { value: WHEEL_UP.delta, beat: 0, channel: 0 },
        ]);
    });

    it('is overridden by a bend the take records itself at beat 0, which follows it', () => {
        holdWheel(0, WHEEL_UP);
        beginTake();
        recordBend(CLIP, 0, WHEEL_DOWN.delta);

        const { pitchBend } = planRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(pitchBend)).toEqual([
            { value: WHEEL_UP.delta, beat: 0, channel: 0 },
            { value: WHEEL_DOWN.delta, beat: 0, channel: 0 },
        ]);
        const lastBendInForce = playedBend(pitchBend).at(-1);
        expect(lastBendInForce).toEqual({ beat: 4, value: WHEEL_DOWN.delta });
    });

    describe('seeds nothing', () => {
        it('for a wheel at rest, whether it never moved or came back to centre', () => {
            holdWheel(0, WHEEL_UP);
            holdWheel(0, CENTRE);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for a wheel Reset All Controllers recentred', () => {
            holdWheel(0, WHEEL_UP);
            admitResetAllControllers(0);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for a clip the recorder did not open', () => {
            holdWheel(0, WHEEL_UP);
            beginTake();

            commitRecordedControllers({ clip: spanOf('existing-clip') });

            expect(midiStore.set).not.toHaveBeenCalled();
        });

        it('for an MPE member channel, whose bend is per-note data the take never records as a channel row', () => {
            webMidiRuntime.mpeEnabled = true;
            holdWheel(0, WHEEL_UP);
            holdWheel(3, WHEEL_DOWN);
            beginTake();

            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: 0 },
            ]);
        });

        it('for a take that was discarded', () => {
            holdWheel(0, WHEEL_UP);
            beginTake();

            discardRecordedControllers(CLIP);
            commitRecordedControllers({ clip: spanOf(CLIP) });

            expect(midiStore.set).not.toHaveBeenCalled();
        });
    });

    it('seeds a channel the same wheel on a non-member channel once MPE is switched off', () => {
        webMidiRuntime.mpeEnabled = false;
        holdWheel(3, WHEEL_DOWN);
        beginTake();

        commitRecordedControllers({ clip: spanOf(CLIP) });

        expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([
            { value: WHEEL_DOWN.delta, beat: 0, channel: 3 },
        ]);
    });

    describe('a take that records into a clip an earlier take still holds in its buffer', () => {
        it('keeps the earlier take seed and adds no second one, because a loop pass is no new take', () => {
            holdWheel(0, WHEEL_UP);
            beginTake();
            recordBend(CLIP, 1, WHEEL_DOWN.delta);
            holdWheel(0, WHEEL_DOWN);

            // The next take begins before the earlier commit ran: the clip is carried over.
            beginTake();
            recordBend(CLIP, 3, WHEEL_UP.delta);
            const { pitchBend } = planRecordedControllers({ clip: spanOf(CLIP) });

            expect(bare(pitchBend)).toEqual([
                { value: WHEEL_UP.delta, beat: 0, channel: 0 },
                { value: WHEEL_DOWN.delta, beat: 1, channel: 0 },
                { value: WHEEL_UP.delta, beat: 3, channel: 0 },
            ]);
        });
    });

    describe('an overdub into a clip the recorder did not open', () => {
        it('adds no row at beat 0 of the existing clip, whose bend before the pass it would rewrite, as pedals and the range do', async () => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: {},
                pitchBendByClipId: { [CLIP]: [{ id: 'earlier', value: 1000, beat: 0, channel: 0 }] },
            };
            holdWheel(0, WHEEL_UP);
            mocks.activeRecordingRef.current = [];
            mocks.targetTrackId.value = TRACK;
            setLiveClips(CLIP);
            beginRecordedControllerTake();
            recordBend(CLIP, 2, WHEEL_DOWN.delta);

            await endRecordedControllerTake();

            expect(bare(mocks.midi.value?.pitchBendByClipId[CLIP])).toEqual([
                { value: 1000, beat: 0, channel: 0 },
                { value: WHEEL_DOWN.delta, beat: 2, channel: 0 },
            ]);
            expect(mocks.dispatched.map((action) => action.type)).toEqual(['appendOverdubControllers']);
        });
    });
});
