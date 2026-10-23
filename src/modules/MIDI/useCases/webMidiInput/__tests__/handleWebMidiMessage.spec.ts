import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultTransportState,
    playheadPositionRef,
    setGestureClockSource,
    transportStore,
} from '#/modules/Transport/stores';

import { memberExpressionState } from '../../../repositories/webMidi/memberExpressionState';
import { resetChannelControllerState } from '../../../repositories/webMidi/resetChannelControllerState';
import { setMpeEnabledInternal } from '../../../repositories/webMidi/setMpeEnabledInternal';
import { setTargetTrackId } from '../../../repositories/webMidi/setTargetTrackId';
import { activeNotes } from '../../../repositories/webMidi/state';

const handle_note_on = vi.hoisted(() => vi.fn());
const handle_note_off = vi.hoisted(() => vi.fn());
const handle_cc = vi.hoisted(() => vi.fn());
const handle_channel_pressure = vi.hoisted(() => vi.fn());
const handle_pitch_bend = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000 }));

vi.mock('../handleWebMidiNoteOn', () => ({
    handleWebMidiNoteOn: handle_note_on,
}));

vi.mock('../handleWebMidiNoteOff', () => ({
    handleWebMidiNoteOff: handle_note_off,
}));

vi.mock('../handleWebMidiCC', () => ({
    handleWebMidiCC: handle_cc,
}));

vi.mock('../handleWebMidiChannelPressure', () => ({
    handleWebMidiChannelPressure: handle_channel_pressure,
}));

vi.mock('../handleWebMidiPitchBend', () => ({
    handleWebMidiPitchBend: handle_pitch_bend,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    applyNoteExpression: vi.fn(),
    audioEngine: { context: audio_clock },
    getCompensationDelay: () => 0,
    getDefaultBendRangeSemitones: () => 48,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: () => false,
}));

const { handleWebMidiMessage } = await import('../handleWebMidiMessage');
const { handleWebMidiPitchBend: actualHandleWebMidiPitchBend } =
    await vi.importActual<typeof import('../handleWebMidiPitchBend')>('../handleWebMidiPitchBend');
const { channelPitchBendState } = await import('../../../repositories/webMidi/channelPitchBendState');
const { resolveChannelBendAtNoteStart } = await import('../resolveChannelBendAtNoteStart');
const { resolveInputEventTime } = await import('../resolveInputEventTime');
const { resolveInputDispatchFrame } = await import('../resolveInputDispatchFrame');

/** Browser receipt time every event in this suite carries. */
const EVENT_TIME_STAMP = 12_345;

function midi_event(data: number[], timeStamp: number = EVENT_TIME_STAMP): MIDIMessageEvent {
    return { data: new Uint8Array(data), timeStamp } as MIDIMessageEvent;
}

describe('handleWebMidiMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        audio_clock.currentTime = 2;
        activeNotes.clear();
        channelPitchBendState.clear();
    });

    it('should dispatch CC bytes to the CC use case', () => {
        handleWebMidiMessage(midi_event([0xb3, 7, 101]));

        // The timestamp is resolved on admission, before a queued handler waits.
        expect(handle_cc).toHaveBeenCalledWith(3, 7, 101, { audioTime: 2 });
    });

    it('should normalize raw note-off release velocity before dispatch', () => {
        handleWebMidiMessage(midi_event([0x81, 72, 96]));

        expect(handle_note_off).toHaveBeenCalledWith(1, 72, 96 / 127, { audioTime: 2 });
    });

    it('should ignore short or empty browser MIDI events', () => {
        handleWebMidiMessage(midi_event([]));
        handleWebMidiMessage(midi_event([0x90]));

        expect(handle_note_on).not.toHaveBeenCalled();
        expect(handle_note_off).not.toHaveBeenCalled();
        expect(handle_cc).not.toHaveBeenCalled();
        expect(handle_channel_pressure).not.toHaveBeenCalled();
        expect(handle_pitch_bend).not.toHaveBeenCalled();
    });

    it('should serialize note events while a Yeast runtime request is pending', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        handle_note_on.mockImplementationOnce(() => noteOnPending);

        handleWebMidiMessage(midi_event([0x90, 60, 100]));
        handleWebMidiMessage(midi_event([0x80, 60, 0]));

        expect(handle_note_on).toHaveBeenCalledTimes(1);
        expect(handle_note_off).not.toHaveBeenCalled();

        resolveNoteOn();
        await noteOnPending;
        await vi.waitFor(() => expect(handle_note_off).toHaveBeenCalledWith(0, 60, 0, { audioTime: 2 }));
    });

    it('should hold a pitch bend behind a pending note-on so the opening bend is not dropped', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        const order: string[] = [];
        handle_note_on.mockImplementationOnce(() => {
            order.push('noteOn');
            return noteOnPending;
        });
        handle_pitch_bend.mockImplementation(() => {
            order.push('pitchBend');
        });

        // An MPE controller sends the member-channel bend together with the
        // note-on. The note-on is queued behind the async tail, so the bend has
        // to queue behind it too — run first it resolves against a
        // channel->note map the note-on has not written yet, returns early, and
        // the note's opening bend is lost (audit MD-3).
        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        handleWebMidiMessage(midi_event([0xe1, 0, 96]));

        expect(order).toEqual(['noteOn']);

        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(['noteOn', 'pitchBend']);
    });

    it('should hold channel pressure and CC behind a pending note-on, in arrival order', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        const order: string[] = [];
        handle_note_on.mockImplementationOnce(() => {
            order.push('noteOn');
            return noteOnPending;
        });
        handle_channel_pressure.mockImplementation(() => {
            order.push('channelPressure');
        });
        handle_cc.mockImplementation(() => {
            order.push('cc');
        });

        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        handleWebMidiMessage(midi_event([0xd1, 90]));
        handleWebMidiMessage(midi_event([0xb1, 74, 40]));

        expect(order).toEqual(['noteOn']);

        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(['noteOn', 'channelPressure', 'cc']);
    });

    it('commits release only after admitted member expression, before the next note on that channel', async () => {
        let releaseFirstOn!: () => void;
        const firstOn = new Promise<void>((resolve) => {
            releaseFirstOn = resolve;
        });
        const order: string[] = [];
        let releaseDone!: () => void;
        const done = new Promise<void>((resolve) => {
            releaseDone = resolve;
        });
        handle_note_on.mockImplementationOnce(() => {
            order.push('on60');
            return firstOn;
        });
        handle_note_on.mockImplementationOnce(() => {
            order.push('on62');
        });
        handle_channel_pressure.mockImplementation(() => {
            order.push('pressure');
        });
        handle_cc.mockImplementation(() => {
            order.push('slide');
        });
        handle_pitch_bend.mockImplementation(() => {
            order.push('bend');
        });
        handle_note_off.mockImplementation(() => {
            order.push('off60');
            releaseDone();
        });

        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        handleWebMidiMessage(midi_event([0xd1, 80]));
        handleWebMidiMessage(midi_event([0xb1, 74, 90]));
        handleWebMidiMessage(midi_event([0xe1, 0, 96]));
        handleWebMidiMessage(midi_event([0x81, 60, 0]));
        handleWebMidiMessage(midi_event([0x91, 62, 100]));
        expect(order).toEqual(['on60']);

        releaseFirstOn();
        await done;
        await vi.waitFor(() => expect(order).toEqual(['on60', 'pressure', 'slide', 'bend', 'off60', 'on62']));
    });

    it.each([
        ['input reset', () => resetChannelControllerState()],
        ['target change', () => setTargetTrackId('new-target')],
        ['MPE transition', () => setMpeEnabledInternal(false)],
    ])('fences accepted expression after %s while a note-on is still in flight', async (_boundary, clear) => {
        let finishOld!: () => void;
        const oldNote = new Promise<void>((resolve) => {
            finishOld = resolve;
        });
        let finishNew!: () => void;
        const newNote = new Promise<void>((resolve) => {
            finishNew = resolve;
        });
        let newInitialPressure: number | undefined;
        handle_note_on.mockReset();
        handle_note_on.mockImplementationOnce(() => oldNote);
        handle_note_on.mockImplementationOnce(() => {
            newInitialPressure = memberExpressionState.get(1)?.pressure;
            finishNew();
        });
        handle_channel_pressure.mockReset();
        handle_channel_pressure.mockImplementation(() => {
            memberExpressionState.set(1, { pressure: 90 });
        });
        memberExpressionState.clear();
        setTargetTrackId('old-target');
        setMpeEnabledInternal(true);

        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        const retiredExpression = handleWebMidiMessage(midi_event([0xd1, 90]));
        clear();
        const currentNote = handleWebMidiMessage(midi_event([0x91, 62, 100]));
        try {
            await vi.waitFor(() => expect(handle_note_on).toHaveBeenCalledTimes(2));
            await currentNote;
            await newNote;
            expect(newInitialPressure).toBeUndefined();
            expect(memberExpressionState.get(1)).toBeUndefined();
        } finally {
            finishOld();
        }
        // This is the retired queue task's completion, not a stale handler
        // callback: the callback must never run after the boundary.
        expect(retiredExpression).toBeInstanceOf(Promise);
        await retiredExpression;
        expect(handle_channel_pressure).not.toHaveBeenCalled();
        expect(memberExpressionState.get(1)).toBeUndefined();

        let laterInitialPressure: number | undefined;
        handle_note_on.mockImplementationOnce(() => {
            laterInitialPressure = memberExpressionState.get(1)?.pressure;
        });
        await handleWebMidiMessage(midi_event([0x91, 64, 100]));
        expect(handle_note_on).toHaveBeenCalledTimes(3);
        expect(laterInitialPressure).toBeUndefined();
    });

    it('keeps an admitted release for an active voice after a target change', async () => {
        let finishNoteOn!: () => void;
        const pending = new Promise<void>((resolve) => {
            finishNoteOn = resolve;
        });
        handle_note_on.mockReset();
        handle_note_off.mockReset();
        handle_note_on.mockImplementationOnce(() => pending);
        activeNotes.set('1:60', {
            startTime: 0,
            startBeat: 0,
            channel: 1,
            note: 60,
            trackId: 'old-target',
            instrumentTrackId: 'old-target',
        });
        setTargetTrackId('old-target');
        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        handleWebMidiMessage(midi_event([0x81, 60, 0]));
        setTargetTrackId('new-target');
        finishNoteOn();
        await vi.waitFor(() => expect(handle_note_off).toHaveBeenCalledWith(1, 60, 0, { audioTime: 2 }));
    });

    it('should not delay expression past its arrival frame behind an unrelated note-on', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        handle_note_on.mockImplementationOnce(() => noteOnPending);

        // The bend records the frame it would voice at, resolved exactly the
        // way the real pitch-bend handler resolves it.
        let bendFrame: number | null = null;
        handle_pitch_bend.mockImplementation(
            (_channel: number, _lsb: number, _msb: number, timeStamp?: number | { audioTime: number }) => {
                bendFrame = resolveInputDispatchFrame({ eventTime: resolveInputEventTime({ timeStamp }) });
            }
        );

        const performance_now = vi.spyOn(performance, 'now');

        // A note-on on channel 1 lands on a Yeast-equipped track and stalls in
        // its cross-thread worker round trip.
        audio_clock.currentTime = 2;
        performance_now.mockReturnValue(1000);
        handleWebMidiMessage(midi_event([0x91, 60, 100], 1000));

        // 50 ms later an unrelated channel-2 bend arrives. It owes nothing to
        // the stalled note, so it must voice at its own arrival frame rather
        // than waiting and being clamped forward to a later render position.
        audio_clock.currentTime = 2.05;
        performance_now.mockReturnValue(1050);
        handleWebMidiMessage(midi_event([0xe2, 0, 96], 1050));

        // 2.05 s at 48 kHz, plus the one-quantum scheduling budget.
        expect(bendFrame).toBe(98_528);

        // Draining the note-on must not retroactively move it.
        audio_clock.currentTime = 2.1;
        performance_now.mockReturnValue(1100);
        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();
        await Promise.resolve();

        expect(bendFrame).toBe(98_528);

        performance_now.mockRestore();
    });

    it('captures the wrapped native transport beat before a queued note-on can wait', async () => {
        const previous = transportStore.value;
        let nativeBeat = 0.12;
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true, playheadPosition: 7.95 });
        playheadPositionRef.current = 7.95;
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => nativeBeat,
        });
        let finishFirst!: () => void;
        const first = new Promise<void>((resolve) => {
            finishFirst = resolve;
        });
        handle_note_on.mockReset();
        handle_note_on.mockImplementationOnce(() => first);
        try {
            handleWebMidiMessage(midi_event([0x91, 60, 100]));
            nativeBeat = 0.15;
            const queued = handleWebMidiMessage(midi_event([0x91, 62, 100]));
            nativeBeat = 1.25;
            finishFirst();
            await queued;
            const centred = { channel: 0, master: 0 };
            expect(handle_note_on).toHaveBeenNthCalledWith(
                1,
                1,
                60,
                100,
                { audioTime: 2, recordingBeat: 0.12 },
                centred
            );
            expect(handle_note_on).toHaveBeenNthCalledWith(
                2,
                1,
                62,
                100,
                { audioTime: 2, recordingBeat: 0.15 },
                centred
            );
        } finally {
            transportStore.set(previous);
            setGestureClockSource({
                getAudioTimeSeconds: () => audio_clock.currentTime,
                readNativeCursorBeats: () => null,
            });
        }
    });

    it.each([
        { name: 'controller', bytes: [0xb1, 64, 127], handler: handle_cc, expectedArgs: [1, 64, 127] },
        { name: 'pitch bend', bytes: [0xe1, 0, 96], handler: handle_pitch_bend, expectedArgs: [1, 0, 96] },
    ])(
        'stamps a queued $name with the beat of its arrival, not the beat its pending note-on resolves at',
        async ({ bytes, handler, expectedArgs }) => {
            const previous = transportStore.value;
            let nativeBeat = 0.12;
            transportStore.set({
                ...defaultTransportState,
                isPlaying: true,
                isRecording: true,
                playheadPosition: 7.95,
            });
            playheadPositionRef.current = 7.95;
            setGestureClockSource({
                getAudioTimeSeconds: () => audio_clock.currentTime,
                readNativeCursorBeats: () => nativeBeat,
            });
            let finishNoteOn!: () => void;
            const noteOnPending = new Promise<void>((resolve) => {
                finishNoteOn = resolve;
            });
            handle_note_on.mockReset();
            handle_note_on.mockImplementationOnce(() => noteOnPending);
            handler.mockReset();
            try {
                handleWebMidiMessage(midi_event([0x91, 60, 100]));
                nativeBeat = 0.15;
                const queued = handleWebMidiMessage(midi_event(bytes));
                nativeBeat = 1.25;
                finishNoteOn();
                await queued;

                expect(handler).toHaveBeenCalledTimes(1);
                expect(handler).toHaveBeenCalledWith(...expectedArgs, { audioTime: 2, recordingBeat: 0.15 });
            } finally {
                transportStore.set(previous);
                setGestureClockSource({
                    getAudioTimeSeconds: () => audio_clock.currentTime,
                    readNativeCursorBeats: () => null,
                });
            }
        }
    );

    it("stamps a recording take's controller and bend with the beat of their own arrival", () => {
        const previous = transportStore.value;
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true, playheadPosition: 7.95 });
        playheadPositionRef.current = 7.95;
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => 3.5,
        });
        try {
            handleWebMidiMessage(midi_event([0xb3, 64, 127]));
            handleWebMidiMessage(midi_event([0xe2, 0, 96]));

            expect(handle_cc).toHaveBeenCalledWith(3, 64, 127, { audioTime: 2, recordingBeat: 3.5 });
            expect(handle_pitch_bend).toHaveBeenCalledWith(2, 0, 96, { audioTime: 2, recordingBeat: 3.5 });
        } finally {
            transportStore.set(previous);
            setGestureClockSource({
                getAudioTimeSeconds: () => audio_clock.currentTime,
                readNativeCursorBeats: () => null,
            });
        }
    });

    describe('the wheel a channel receives', () => {
        beforeEach(() => {
            channelPitchBendState.clear();
            setMpeEnabledInternal(false);
            setTargetTrackId('wheel-target');
            handle_note_on.mockReset();
            handle_pitch_bend.mockReset();
            handle_pitch_bend.mockImplementation(actualHandleWebMidiPitchBend);
        });

        afterEach(() => {
            handle_pitch_bend.mockReset();
            setMpeEnabledInternal(false);
            channelPitchBendState.clear();
        });

        /** What a note struck now on channel 1, outside MPE, starts under. */
        function startBendOnChannelOne() {
            return resolveChannelBendAtNoteStart({ channel: 1, mpeEnabled: false, ownPitchBend: undefined });
        }

        it.each([
            ['transport reset', () => resetChannelControllerState()],
            ['target change', () => setTargetTrackId('other-target')],
            ['MPE toggle', () => setMpeEnabledInternal(true)],
        ])(
            'keeps a centring bend queued behind a note-on that a %s then fences, so the next note starts unbent',
            async (_boundary, fence) => {
                let finishNoteOn!: () => void;
                const noteOnInFlight = new Promise<void>((resolve) => {
                    finishNoteOn = resolve;
                });
                handle_note_on.mockImplementationOnce(() => noteOnInFlight);
                handleWebMidiMessage(midi_event([0xe1, 0, 96]));
                expect(startBendOnChannelOne()?.pitchBend).toBe(4096);

                handleWebMidiMessage(midi_event([0x91, 60, 100]));
                const queuedCentre = handleWebMidiMessage(midi_event([0xe1, 0, 64]));
                fence();
                finishNoteOn();
                await noteOnInFlight;
                await queuedCentre;

                expect(startBendOnChannelOne()).toBeUndefined();
            }
        );

        it('starts a queued note at the wheel it was admitted under, and the bend queued behind it moves it', async () => {
            let finishFirstNoteOn!: () => void;
            const firstNoteOnInFlight = new Promise<void>((resolve) => {
                finishFirstNoteOn = resolve;
            });
            let secondNoteStart: ReturnType<typeof resolveChannelBendAtNoteStart>;
            handle_note_on.mockImplementationOnce(() => firstNoteOnInFlight);
            handle_note_on.mockImplementationOnce(
                (_channel: number, _note: number, _velocity: number, _time: unknown, admittedWheels: unknown) => {
                    secondNoteStart = resolveChannelBendAtNoteStart({
                        channel: 1,
                        mpeEnabled: false,
                        ownPitchBend: undefined,
                        admittedWheels: admittedWheels as Parameters<
                            typeof resolveChannelBendAtNoteStart
                        >[0]['admittedWheels'],
                    });
                }
            );

            handleWebMidiMessage(midi_event([0x91, 60, 100]));
            handleWebMidiMessage(midi_event([0x91, 62, 100]));
            const queuedBend = handleWebMidiMessage(midi_event([0xe1, 0, 96]));

            // The bend is held from its arrival, but it arrived behind the note.
            expect(startBendOnChannelOne()?.pitchBend).toBe(4096);
            expect(handle_pitch_bend).not.toHaveBeenCalled();

            finishFirstNoteOn();
            await queuedBend;

            expect(secondNoteStart).toBeUndefined();
            expect(handle_pitch_bend).toHaveBeenCalledWith(1, 0, 96, { audioTime: 2 });
        });

        it('hands a note-on the wheel of its channel and the zone master as they stood when it arrived', () => {
            handleWebMidiMessage(midi_event([0xe1, 0, 96]));
            handleWebMidiMessage(midi_event([0xe0, 0, 32]));

            handleWebMidiMessage(midi_event([0x91, 60, 100]));

            expect(handle_note_on).toHaveBeenCalledWith(
                1,
                60,
                100,
                { audioTime: 2, recordingBeat: expect.any(Number) },
                {
                    channel: 4096,
                    master: -4096,
                }
            );
        });

        it('keeps an MPE member-channel bend as the channel wheel for a note struck after MPE is switched off', () => {
            setMpeEnabledInternal(true);
            handleWebMidiMessage(midi_event([0xe2, 0, 96]));
            expect(channelPitchBendState.get(2)).toBe(4096);
            handleWebMidiMessage(midi_event([0xe2, 0, 64]));
            setMpeEnabledInternal(false);

            expect(channelPitchBendState.get(2)).toBe(0);
        });

        it('recentres a channel on Reset All Controllers when it is received, in arrival order with the bends around it', async () => {
            let finishNoteOn!: () => void;
            const noteOnInFlight = new Promise<void>((resolve) => {
                finishNoteOn = resolve;
            });
            handle_note_on.mockImplementationOnce(() => noteOnInFlight);
            handleWebMidiMessage(midi_event([0xe1, 0, 96]));
            handleWebMidiMessage(midi_event([0xe2, 0, 96]));

            handleWebMidiMessage(midi_event([0x91, 60, 100]));
            const queuedReset = handleWebMidiMessage(midi_event([0xb1, 121, 0]));
            resetChannelControllerState();
            finishNoteOn();
            await queuedReset;

            expect(startBendOnChannelOne()).toBeUndefined();
            expect(channelPitchBendState.get(2)).toBe(4096);
        });
    });
});
