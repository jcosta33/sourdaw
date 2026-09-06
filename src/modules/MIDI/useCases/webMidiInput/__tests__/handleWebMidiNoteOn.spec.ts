import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const target_track_id = vi.hoisted<{ value: string | null }>(() => ({ value: 'track-1' }));
const mpe_enabled = vi.hoisted(() => ({ value: false }));
const ensure_track_strip = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));

type TestMidiEvent = {
    timeSamples: number;
    kind:
        | { type: 'noteOn'; channel: number; note: number; velocity: number }
        | { type: 'noteOff'; channel: number; note: number };
};

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => target_track_id.value,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: audio_clock,
        ensureTrackStrip: ensure_track_strip,
        getTrackStrip: get_track_strip,
    },
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: async () => true,
}));

const { handleWebMidiNoteOn } = await import('../handleWebMidiNoteOn');
const { handleWebMidiNoteOff } = await import('../handleWebMidiNoteOff');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

type HandleWebMidiNoteOnDependencies = Parameters<typeof handleWebMidiNoteOn._factory>[0];

function make_dependencies(overrides: Partial<HandleWebMidiNoteOnDependencies> = {}): HandleWebMidiNoteOnDependencies {
    return {
        getTrackStoreState: () => ({
            tracks: [{ id: 'track-1', devices: [] }],
            selectedTrackId: 'track-1',
        }),
        getTransportStoreValue: () => ({ isRecording: false }),
        playheadPositionRef: { current: 0 },
        stepRecordNoteOn: () => {},
        processRealtimeMidiInput: async () => [],
        getSynthParamsForTrack: () => ({ detune: 0, release: 0.3 }),
        scheduleNote: () => null,
        scheduleKitNote: () => null,
        getDrumKitByIndex: () => null,
        getDrumKitDefByIndex: () => null,
        scheduleDrumKitNote: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        handleWebMidiNoteOff: async () => {},
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiNote: async () => true,
        ...overrides,
    };
}

/**
 * Frame a live note lands on with the harness clock at 2 s / 48 kHz and no
 * event timestamp: the arrival frame plus the one-render-quantum scheduling
 * budget `resolveInputDispatchFrame` applies (audit MD-1).
 */
const LIVE_DISPATCH_FRAME = 96_128;
describe('handleWebMidiNoteOn', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        ensure_track_strip.mockReset();
        get_track_strip.mockReset();
        target_track_id.value = 'track-1';
        mpe_enabled.value = false;
        audio_clock.currentTime = 2;
    });

    it('should emit Yeast-routed Grand Boule note-on events with the device id', async () => {
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const grand_boule_note_on = vi.fn<(note: number, velocity: number, sampleFrame?: number) => void>();
        const grand_boule_note_off = vi.fn<(note: number, sampleFrame?: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'gb-1', type: 'grand-boule' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: async (): Promise<TestMidiEvent[]> => [
                    { timeSamples: 96_240, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                    { timeSamples: 96_480, kind: { type: 'noteOff', channel: 0, note: 67 } },
                ],
                eventBus: {
                    emit: (type: string, payload: Record<string, unknown>) => {
                        emitted.push({ type, payload });
                        return Promise.resolve();
                    },
                    on: () => () => {},
                },
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { noteOn: grand_boule_note_on, noteOff: grand_boule_note_off },
                },
            ],
        });

        await fn(0, 60, 100);

        // The member channel is stamped on the voice so per-note expression
        // can address this note rather than the pitch (audit MD-2).
        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_240, 0);
        expect(grand_boule_note_off).toHaveBeenCalledWith(67, 96_480, undefined, 0);
        expect(emitted).toContainEqual({
            type: 'midi.noteOn',
            payload: { deviceId: 'gb-1', midiNote: 67, velocity: 100 / 127 },
        });
    });

    it('should await the Yeast runtime before routing transformed note-ons', async () => {
        const grand_boule_note_on = vi.fn<(note: number, velocity: number, sampleFrame?: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'gb-1', type: 'grand-boule' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: vi.fn(async () => [
                    { timeSamples: 96_240, kind: { type: 'noteOn' as const, channel: 0, note: 67, velocity: 100 } },
                ]),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                { type: 'grand-boule', deviceId: 'gb-1', grandBouleControls: { noteOn: grand_boule_note_on } },
            ],
        });

        await fn(0, 60, 100);

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_240, 0);
    });

    it('reuses the note-on identity for the paired Yeast note-off', async () => {
        const getTrackStoreState = () => ({
            tracks: [{ id: 'track-1', armed: false, devices: [{ id: 'yeast-1', type: 'yeast' }], clips: [] }],
            selectedTrackId: 'track-1',
        });
        const processRealtimeMidiInput = vi.fn(async () => []);
        const noteOff = handleWebMidiNoteOff._factory({
            getCompensationDelay: () => 0,
            getTrackStoreState,
            getTransportStoreValue: () => ({ isRecording: false }),
            playheadPositionRef: { current: 0 },
            createMidiNote: () => ({ id: 'unused', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }),
            appendRecordedMidiNote: () => {},
            getSynthParamsForTrack: () => ({ release: 0.3 }),
            processRealtimeMidiInput,
            stepRecordNoteOff: () => {},
            eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        });
        const noteOn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState,
                getTransportStoreValue: () => ({ isRecording: false }),
                processRealtimeMidiInput,
                handleWebMidiNoteOff: noteOff,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
        get_track_strip.mockReturnValue({ deviceNodes: [] });

        await noteOn(2, 60, 100);

        const noteInstanceId = activeNotes.get(createWebMidiNoteKey(2, 60))?.noteInstanceId;
        expect(noteInstanceId).toBe('track-1:2:60:96000');
        expect(processRealtimeMidiInput).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ isNoteOn: true, noteInstanceId })
        );

        await noteOff(2, 60);

        expect(processRealtimeMidiInput).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ isNoteOn: false, noteInstanceId })
        );
    });

    it('dispatches a missed Yeast deadline at the current AudioContext frame', async () => {
        const grand_boule_note_on = vi.fn<(note: number, velocity: number, sampleFrame?: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'gb-1', type: 'grand-boule' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: async () => [
                    { timeSamples: 95_000, kind: { type: 'noteOn' as const, channel: 0, note: 67, velocity: 100 } },
                ],
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                { type: 'grand-boule', deviceId: 'gb-1', grandBouleControls: { noteOn: grand_boule_note_on } },
            ],
        });

        await fn(0, 60, 100);

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_000, 0);
    });

    it('releases an existing same-channel pitch before retriggering it', async () => {
        const key = createWebMidiNoteKey(1, 60);
        activeNotes.set(key, {
            channel: 1,
            note: 60,
            trackId: 'track-old',
            instrumentTrackId: 'track-old',
            startTime: 1,
            startBeat: 0,
        });
        const release = vi.fn(async (channel: number, note: number) => {
            activeNotes.delete(createWebMidiNoteKey(channel, note));
        });
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                handleWebMidiNoteOff: release,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        // Pin the wall clock to the event's own stamp so the arrival maths
        // resolves to "just now" regardless of how long this process has run.
        const performance_now = vi.spyOn(performance, 'now').mockReturnValue(4242);
        await fn(1, 60, 100, 4242);

        expect(release).toHaveBeenCalledTimes(1);
        // The implicit release inherits the retriggering event's own arrival
        // time, so the note it cuts is not stretched by handler lag either.
        expect(release).toHaveBeenCalledWith(1, 60, 0, 4242);
        expect(activeNotes.get(key)).toEqual(expect.objectContaining({ trackId: 'track-1', startTime: 2 }));
        performance_now.mockRestore();
    });

    it('retains same-pitch notes on separate channels and originating tracks', async () => {
        const release = vi.fn(async () => {});
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        { id: 'track-1', devices: [] },
                        { id: 'track-2', devices: [] },
                    ],
                    selectedTrackId: target_track_id.value,
                }),
                handleWebMidiNoteOff: release,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(1, 60, 100);
        target_track_id.value = 'track-2';
        await fn(2, 60, 100);

        expect(activeNotes.size).toBe(2);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.trackId).toBe('track-1');
        expect(activeNotes.get(createWebMidiNoteKey(2, 60))?.trackId).toBe('track-2');
        expect(release).not.toHaveBeenCalled();
    });

    it('releases the prior note before reusing an MPE member channel for another pitch', async () => {
        mpe_enabled.value = true;
        const release = vi.fn(async (channel: number, note: number) => {
            activeNotes.delete(createWebMidiNoteKey(channel, note));
        });
        const fn = handleWebMidiNoteOn._factory(make_dependencies({ handleWebMidiNoteOff: release }));
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(3, 60, 100);
        await fn(3, 62, 100);

        expect(release).toHaveBeenCalledWith(3, 60, 0, undefined);
        expect(activeNotes.has(createWebMidiNoteKey(3, 60))).toBe(false);
        expect(activeNotes.get(createWebMidiNoteKey(3, 62))?.note).toBe(62);
        expect(channelToNote.get(3)).toBe(createWebMidiNoteKey(3, 62));
    });

    it('removes the registered note when Yeast realtime processing rejects', async () => {
        mpe_enabled.value = true;
        const error = new Error('yeast worklet failed');
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'yeast-1', type: 'yeast' }] }],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: async () => {
                    throw error;
                },
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await expect(fn(1, 60, 100)).rejects.toBe(error);

        expect(activeNotes.has(createWebMidiNoteKey(1, 60))).toBe(false);
        expect(channelToNote.has(1)).toBe(false);
    });

    it('routes a Fermenter note-on to the device and records its id for later release', async () => {
        const fermenter_note_on = vi.fn<(note: number, velocity: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'ferm-1', type: 'fermenter' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                {
                    type: 'fermenter',
                    deviceId: 'ferm-1',
                    fermenterControls: { ready: true, noteOn: fermenter_note_on },
                },
            ],
        });

        await fn(0, 64, 95);

        expect(fermenter_note_on).toHaveBeenCalledWith(64, 95, LIVE_DISPATCH_FRAME, 0);
        expect(activeNotes.get(createWebMidiNoteKey(0, 64))?.fermenterDeviceId).toBe('ferm-1');
    });

    it('maps a Toaster note to pad 0 with a fixed 60 pitch when no child pad is resolved', async () => {
        // With no resolved child pad, the toaster maps by MIDI note: pad = note - 36, and
        // notes in the second octave (note 60..75) wrap back to pads 0..15. The pitched
        // sample is fixed at 60.
        const toaster_note_on = vi.fn<(pad: number, velocity: number, pitchNote: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'toast-1', type: 'toaster' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [{ type: 'toaster', deviceId: 'toast-1', toasterControls: { noteOn: toaster_note_on } }],
        });

        // note 60 -> pad = 60 - 36 = 24, in [24,39] so pad -= 24 -> 0, pitchNote 60.
        await fn(0, 60, 100);

        expect(toaster_note_on).toHaveBeenCalledWith(0, 100, 60, LIVE_DISPATCH_FRAME);
        expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.toasterRoute).toEqual({ deviceId: 'toast-1', pad: 0 });
    });

    it('maps a low Toaster note (36) to pad 0 in the first octave', async () => {
        const toaster_note_on = vi.fn<(pad: number, velocity: number, pitchNote: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'toast-1', type: 'toaster' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [{ type: 'toaster', deviceId: 'toast-1', toasterControls: { noteOn: toaster_note_on } }],
        });

        // note 36 -> pad = 0 (first octave), not in [24,39], pitchNote 60.
        await fn(0, 36, 100);

        expect(toaster_note_on).toHaveBeenCalledWith(0, 100, 60, LIVE_DISPATCH_FRAME);
    });

    it('routes a Grand Boule note-on applying the velocity curve from calibration', async () => {
        const grand_boule_note_on =
            vi.fn<(note: number, velocity: number, sampleFrame?: number, channel?: number) => void>();
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'gb-1', type: 'grand-boule' }] }],
                    selectedTrackId: 'track-1',
                }),
                eventBus: {
                    emit: (type: string, payload: Record<string, unknown>) => {
                        emitted.push({ type, payload });
                        return Promise.resolve();
                    },
                    on: () => () => {},
                },
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { ready: true, noteOn: grand_boule_note_on },
                },
            ],
        });

        await fn(0, 60, 100);

        // Without a calibration store the velocity falls back to velocity/127.
        expect(grand_boule_note_on).toHaveBeenCalledWith(60, 100 / 127, LIVE_DISPATCH_FRAME, 0);
        expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.grandBouleDeviceId).toBe('gb-1');
        expect(emitted).toContainEqual({
            type: 'midi.noteOn',
            payload: { deviceId: 'gb-1', midiNote: 60, velocity: 100 / 127 },
        });
    });

    it('routes a Levain note-on to the device controls', async () => {
        const levain_note_on = vi.fn<(note: number, velocity: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'lev-1', type: 'levain' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                { type: 'levain', deviceId: 'lev-1', levainControls: { ready: true, noteOn: levain_note_on } },
            ],
        });

        await fn(0, 72, 88);

        expect(levain_note_on).toHaveBeenCalledWith(72, 88, LIVE_DISPATCH_FRAME, 0);
        expect(activeNotes.get(createWebMidiNoteKey(0, 72))?.levainDeviceId).toBe('lev-1');
    });

    it('schedules a builtin synth note and stores the oscillator for later release', async () => {
        const oscillator = { _env: { gain: {} } };
        const schedule_note = vi.fn(() => oscillator);
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'syn-1', type: 'builtin-synth-foo' }] }],
                    selectedTrackId: 'track-1',
                }),
                scheduleNote: schedule_note,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(0, 60, 100);

        expect(schedule_note).toHaveBeenCalledTimes(1);
        expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.osc).toBe(oscillator);
    });

    it('schedules a builtin drum kit note using the kit definition when available', async () => {
        const schedule_drum_kit_note = vi.fn();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [{ id: 'kit-1', type: 'builtin-drum-kit', parameterValues: { kit: 2 } }],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                getDrumKitDefByIndex: () => ({ id: 'kit-def-2' }),
                scheduleDrumKitNote: schedule_drum_kit_note,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(0, 36, 110);

        expect(schedule_drum_kit_note).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            { id: 'kit-def-2' },
            36,
            expect.anything(),
            110
        );
    });

    it('logs a warning and returns early when no target track is selected', async () => {
        target_track_id.value = null;
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const fn = handleWebMidiNoteOn._factory(make_dependencies());
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(0, 60, 100);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('No target track'));
        // With no target track the note-on is abandoned: it is not registered in activeNotes
        // and no device is engaged.
        expect(activeNotes.has(createWebMidiNoteKey(0, 60))).toBe(false);
        warn.mockRestore();
    });

    it('should space two live notes by their arrival offset, not by handler-run time', async () => {
        const fermenter_note_on = vi.fn<(note: number, velocity: number, sampleFrame?: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'f-1', type: 'fermenter' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                {
                    type: 'fermenter',
                    deviceId: 'f-1',
                    fermenterControls: { ready: true, noteOn: fermenter_note_on, noteOff: vi.fn() },
                },
            ],
        });
        const performance_now = vi.spyOn(performance, 'now');

        // Two notes the player performed 10 ms apart. The second handler runs
        // 1 ms late — ordinary main-thread jitter. Onset spacing has to stay
        // the performed 10 ms, not the 11 ms the event loop happened to take
        // (audit MD-1).
        audio_clock.currentTime = 2;
        performance_now.mockReturnValue(1000);
        await fn(0, 60, 100, 1000);

        audio_clock.currentTime = 2.011;
        performance_now.mockReturnValue(1011);
        await fn(0, 64, 100, 1010);

        const first_frame = fermenter_note_on.mock.calls[0]![2];
        const second_frame = fermenter_note_on.mock.calls[1]![2];
        expect(typeof first_frame).toBe('number');
        expect(typeof second_frame).toBe('number');
        // 10 ms at 48 kHz. Handler-run time would have spaced them 528.
        expect(second_frame! - first_frame!).toBe(480);

        performance_now.mockRestore();
    });

    describe('native-carried instrument', () => {
        it('sends a note-on to a carried hosted instrument instead of voicing it on Web Audio', async () => {
            const send_native_live_midi_note = vi.fn(async () => true);
            const schedule_note = vi.fn(() => null);
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [
                            {
                                id: 'track-1',
                                devices: [{ id: 'plug-1', type: 'plugin', externalInstanceId: 'inst-1' }],
                            },
                        ],
                        selectedTrackId: 'track-1',
                    }),
                    isDeviceCarriedByNativeSession: (trackId: string, deviceId: string) =>
                        trackId === 'track-1' && deviceId === 'plug-1',
                    sendNativeLiveMidiNote: send_native_live_midi_note,
                    scheduleNote: schedule_note,
                })
            );
            ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

            await fn(0, 60, 100);

            expect(send_native_live_midi_note).toHaveBeenCalledTimes(1);
            expect(send_native_live_midi_note).toHaveBeenCalledWith({
                trackId: 'track-1',
                deviceId: 'plug-1',
                note: 60,
                velocity: 100,
                channel: 0,
                isNoteOn: true,
            });
            expect(schedule_note).not.toHaveBeenCalled();
            expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.nativeDeviceId).toBe('plug-1');
        });

        it('voices a hosted instrument on Web Audio while no native session carries it', async () => {
            const send_native_live_midi_note = vi.fn(async () => true);
            const schedule_note = vi.fn(() => null);
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [
                            {
                                id: 'track-1',
                                devices: [{ id: 'plug-1', type: 'plugin', externalInstanceId: 'inst-1' }],
                            },
                        ],
                        selectedTrackId: 'track-1',
                    }),
                    isDeviceCarriedByNativeSession: () => false,
                    sendNativeLiveMidiNote: send_native_live_midi_note,
                    scheduleNote: schedule_note,
                })
            );
            ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

            await fn(0, 60, 100);

            expect(send_native_live_midi_note).not.toHaveBeenCalled();
            expect(schedule_note).toHaveBeenCalledTimes(1);
            expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.nativeDeviceId).toBeUndefined();
        });

        it('lets the native body take the note ahead of a built-in on the same track', async () => {
            const send_native_live_midi_note = vi.fn(async () => true);
            const fermenter_note_on = vi.fn();
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [
                            {
                                id: 'track-1',
                                devices: [
                                    { id: 'plug-1', type: 'plugin', externalInstanceId: 'inst-1' },
                                    { id: 'ferm-1', type: 'fermenter' },
                                ],
                            },
                        ],
                        selectedTrackId: 'track-1',
                    }),
                    isDeviceCarriedByNativeSession: (trackId: string, deviceId: string) =>
                        trackId === 'track-1' && deviceId === 'plug-1',
                    sendNativeLiveMidiNote: send_native_live_midi_note,
                })
            );
            ensure_track_strip.mockReturnValue({
                gainNode: {},
                deviceNodes: [
                    {
                        type: 'fermenter',
                        deviceId: 'ferm-1',
                        fermenterControls: { ready: true, noteOn: fermenter_note_on, noteOff: vi.fn() },
                    },
                ],
            });

            await fn(0, 60, 100);

            expect(send_native_live_midi_note).toHaveBeenCalledTimes(1);
            expect(fermenter_note_on).not.toHaveBeenCalled();
        });

        it('sends the note to the carried parent instrument when a toaster child is the target', async () => {
            const send_native_live_midi_note = vi.fn(async () => true);
            const toaster_note_on = vi.fn();
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [
                            {
                                id: 'parent-1',
                                devices: [
                                    { id: 'toast-1', type: 'toaster' },
                                    { id: 'plug-1', type: 'plugin', externalInstanceId: 'inst-1' },
                                ],
                            },
                            { id: 'child-1', parentId: 'parent-1', devices: [] },
                        ],
                        selectedTrackId: 'child-1',
                    }),
                    isDeviceCarriedByNativeSession: (trackId: string, deviceId: string) =>
                        trackId === 'parent-1' && deviceId === 'plug-1',
                    sendNativeLiveMidiNote: send_native_live_midi_note,
                })
            );
            target_track_id.value = 'child-1';
            ensure_track_strip.mockReturnValue({
                gainNode: {},
                deviceNodes: [
                    {
                        type: 'toaster',
                        deviceId: 'toast-1',
                        toasterControls: { noteOn: toaster_note_on, noteOff: vi.fn() },
                    },
                ],
            });

            await fn(0, 60, 100);

            expect(send_native_live_midi_note).toHaveBeenCalledWith({
                trackId: 'parent-1',
                deviceId: 'plug-1',
                note: 60,
                velocity: 100,
                channel: 0,
                isNoteOn: true,
            });
            expect(toaster_note_on).not.toHaveBeenCalled();
        });
    });
});
