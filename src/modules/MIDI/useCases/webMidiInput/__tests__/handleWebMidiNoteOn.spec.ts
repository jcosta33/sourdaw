import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { defaultTransportState, setGestureClockSource, transportStore } from '#/modules/Transport/stores';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { type RealtimeMidiInput } from '../../../repositories/webMidi/realtimeMidiProcessorState';

const target_track_id = vi.hoisted<{ value: string | null }>(() => ({ value: 'track-1' }));
const mpe_enabled = vi.hoisted(() => ({ value: false }));
const ensure_track_strip = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));
const start_faust_note = vi.hoisted(() => vi.fn<(...args: unknown[]) => () => void>());
/** Stand-in for the PluginHost Faust registry: which device types are Faust instruments. */
const faust_instrument_types = vi.hoisted(() => ({ value: new Set<string>() }));

type TestMidiEvent = {
    timeSamples: number;
    noteInstanceId?: string;
    durationSamples?: number;
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
    getDefaultBendRangeSemitones: () => 48,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: (type: string) => type === 'fermenter',
    startFaustNote: start_faust_note,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    registerFaustDSP: vi.fn(),
    isFaustInstrumentModule: (moduleId: string) => faust_instrument_types.value.has(moduleId),
}));

const { handleWebMidiNoteOn } = await import('../handleWebMidiNoteOn');
const { handleWebMidiNoteOff } = await import('../handleWebMidiNoteOff');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');
const { resetChannelControllerState } = await import('../../../repositories/webMidi/resetChannelControllerState');
const { resetLiveInputDispatchFrameFloor } = await import('../../../services/liveInputDispatchFrameFloor');

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
        soundsNativeNotes: (type: string) => type === 'fermenter',
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
        resetLiveInputDispatchFrameFloor();
        activeNotes.clear();
        channelToNote.clear();
        ensure_track_strip.mockReset();
        get_track_strip.mockReset();
        start_faust_note.mockReset();
        target_track_id.value = 'track-1';
        mpe_enabled.value = false;
        faust_instrument_types.value = new Set();
        audio_clock.currentTime = 2;
    });

    it('captures a wrapped native beat at direct note-on before its first await', async () => {
        const previous = transportStore.value;
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true, playheadPosition: 7.95 });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => 0.12,
        });
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
        try {
            const fn = handleWebMidiNoteOn._factory(make_dependencies({ playheadPositionRef: { current: 7.95 } }));
            await fn(1, 60, 100);
            expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBe(0.12);
        } finally {
            transportStore.set(previous);
            setGestureClockSource({
                getAudioTimeSeconds: () => audio_clock.currentTime,
                readNativeCursorBeats: () => null,
            });
        }
    });

    it.each(['fermenter', 'grand-boule', 'levain'] as const)(
        'releases a Yeast-transformed %s note-off through the control that voiced it after strip reorder',
        async (deviceType) => {
            const originalOff = vi.fn();
            const replacementOff = vi.fn();
            const eventBusEmit = vi.fn(async () => {});
            const controls = (noteOff: ReturnType<typeof vi.fn>, noteOn: (...args: unknown[]) => void) => ({
                noteOff,
                noteOn,
            });
            const strip = {
                gainNode: {},
                deviceNodes: [] as Array<{
                    deviceId: string;
                    type: string;
                    fermenterControls: ReturnType<typeof controls>;
                    grandBouleControls: ReturnType<typeof controls>;
                    levainControls: ReturnType<typeof controls>;
                }>,
            };
            const replacement = {
                deviceId: 'replacement',
                type: deviceType,
                fermenterControls: controls(replacementOff, () => {}),
                grandBouleControls: controls(replacementOff, () => {}),
                levainControls: controls(replacementOff, () => {}),
            };
            const original = {
                deviceId: 'original',
                type: deviceType,
                fermenterControls: controls(originalOff, () => {
                    strip.deviceNodes.unshift(replacement);
                }),
                grandBouleControls: controls(originalOff, () => {
                    strip.deviceNodes.unshift(replacement);
                }),
                levainControls: controls(originalOff, () => {
                    strip.deviceNodes.unshift(replacement);
                }),
            };
            strip.deviceNodes.push(original);
            ensure_track_strip.mockReturnValue(strip);
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [
                            {
                                id: 'track-1',
                                devices: [
                                    { id: 'yeast-1', type: 'yeast' },
                                    { id: 'original', type: deviceType },
                                ],
                            },
                        ],
                        selectedTrackId: 'track-1',
                    }),
                    processRealtimeMidiInput: async (): Promise<TestMidiEvent[]> => [
                        { timeSamples: 96_000, kind: { type: 'noteOn', channel: 1, note: 67, velocity: 100 } },
                        { timeSamples: 96_100, kind: { type: 'noteOff', channel: 1, note: 67 } },
                    ],
                    eventBus: { emit: eventBusEmit, on: () => () => {} },
                })
            );

            await fn(1, 60, 100);
            if (deviceType === 'grand-boule') {
                expect(originalOff).toHaveBeenCalledWith(67, 96_100, undefined, 1);
            } else {
                expect(originalOff).toHaveBeenCalledWith(67, 96_100, 1);
            }
            expect(replacementOff).not.toHaveBeenCalled();
            if (deviceType === 'grand-boule') {
                expect(eventBusEmit).toHaveBeenCalledWith(
                    'midi.noteOff',
                    expect.objectContaining({ deviceId: 'original', midiNote: 67 })
                );
            }
        }
    );

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
        expect(noteInstanceId).toMatch(/^track-1:2:60:96000:\d+$/);
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

    // The instance-keyed guard in the drained stream: a note-off whose
    // instance id resolves nowhere in the shared registry — a repeat, or an
    // unknown identity — must stop there, not fall through to the source-pitch
    // step release the batch's own captured voice holds at that pitch.
    it('keeps the captured step voice when a drained instance-keyed note-off resolves nowhere', async () => {
        const fermenter_note_on =
            vi.fn<(note: number, velocity: number, sampleFrame?: number, channel?: number) => void>();
        const fermenter_note_off = vi.fn<(note: number, sampleFrame?: number, channel?: number) => void>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'ferm-1', type: 'fermenter' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: async (): Promise<TestMidiEvent[]> => [
                    // The source pitch's step voice: a generated note-on
                    // without an instance id captures into the note's own
                    // release map.
                    { timeSamples: 96_240, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                    // A stale or unknown generated identity: the registry
                    // holds no such voice on this route.
                    {
                        timeSamples: 96_480,
                        noteInstanceId: 'arp-1:ghost:1',
                        kind: { type: 'noteOff', channel: 0, note: 67 },
                    },
                ],
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                {
                    type: 'fermenter',
                    deviceId: 'ferm-1',
                    fermenterControls: { noteOn: fermenter_note_on, noteOff: fermenter_note_off },
                },
            ],
        });

        await fn(0, 60, 100);

        expect(fermenter_note_on).toHaveBeenCalledWith(67, 100, 96_240, 0);
        // The unresolved instance note-off is consumed by the guard; the step
        // voice captured above survives it.
        expect(fermenter_note_off).not.toHaveBeenCalled();
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

    it('does not voice a worker result after the input was reset', async () => {
        let finishWorker!: (events: TestMidiEvent[]) => void;
        const worker = new Promise<TestMidiEvent[]>((resolve) => {
            finishWorker = resolve;
        });
        const voiced = vi.fn();
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
                processRealtimeMidiInput: () => worker,
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [{ type: 'grand-boule', deviceId: 'gb-1', grandBouleControls: { noteOn: voiced } }],
        });
        const pending = fn(1, 60, 100);
        expect(activeNotes.has(createWebMidiNoteKey(1, 60))).toBe(true);

        resetChannelControllerState();
        activeNotes.clear();
        channelToNote.clear();
        finishWorker([{ timeSamples: 96_240, kind: { type: 'noteOn', channel: 1, note: 60, velocity: 100 } }]);
        await pending;

        expect(voiced).not.toHaveBeenCalled();
        expect(activeNotes.has(createWebMidiNoteKey(1, 60))).toBe(false);
    });

    it('does not erase a fresh same-key note when the retired worker rejects', async () => {
        let rejectWorker!: (error: Error) => void;
        const worker = new Promise<TestMidiEvent[]>((_resolve, reject) => {
            rejectWorker = reject;
        });
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'yeast-1', type: 'yeast' }] }],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: () => worker,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
        const pending = fn(1, 60, 100);
        const key = createWebMidiNoteKey(1, 60);
        resetChannelControllerState();
        const fresh = {
            startTime: 3,
            startBeat: 1,
            channel: 1,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
        };
        activeNotes.set(key, fresh);
        channelToNote.set(1, key);
        rejectWorker(new Error('retired worker'));
        await expect(pending).rejects.toThrow('retired worker');
        expect(activeNotes.get(key)).toBe(fresh);
        expect(channelToNote.get(1)).toBe(key);
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

    // Sequenced playback, audition and export resolve the drum device and kit
    // through `resolveDrumKitBy`: every drum device type, `kit` first, then the
    // legacy `kitId`, then index 0. Live input has to pick the same kit.
    it.each([
        { type: 'drum-kit', parameterValues: { kitId: 2 }, kitIndex: 2 },
        { type: 'builtin-drum-kit', parameterValues: { kitId: 3 }, kitIndex: 3 },
        { type: 'builtin-drum-machine-808', parameterValues: { kit: 1, kitId: 3 }, kitIndex: 1 },
        { type: 'builtin-drum-machine-analog', parameterValues: {}, kitIndex: 0 },
    ])(
        'resolves the kit definition of a $type device with $parameterValues as kit $kitIndex',
        async ({ type, parameterValues, kitIndex }) => {
            const schedule_drum_kit_note = vi.fn();
            const get_kit_def = vi.fn((index: number) => ({ id: `kit-def-${index}` }));
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [{ id: 'track-1', devices: [{ id: 'kit-1', type, parameterValues }] }],
                        selectedTrackId: 'track-1',
                    }),
                    getDrumKitDefByIndex: get_kit_def,
                    scheduleDrumKitNote: schedule_drum_kit_note,
                })
            );
            ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

            await fn(0, 36, 110);

            expect(get_kit_def).toHaveBeenCalledWith(kitIndex);
            expect(schedule_drum_kit_note).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                { id: `kit-def-${kitIndex}` },
                36,
                expect.anything(),
                110
            );
        }
    );

    it('falls back to the factory kit the same device selects when no kit definition covers it', async () => {
        const schedule_kit_note = vi.fn(() => null);
        const get_kit = vi.fn((index: number) => ({ id: `factory-${index}` }));
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [{ id: 'kit-1', type: 'drum-kit', parameterValues: { kitId: 4 } }],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                getDrumKitDefByIndex: () => null,
                getDrumKitByIndex: get_kit,
                scheduleKitNote: schedule_kit_note,
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(0, 36, 110);

        expect(get_kit).toHaveBeenCalledWith(4);
        expect(schedule_kit_note).toHaveBeenCalledTimes(1);
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

    describe('Faust pro-synth instrument', () => {
        it('routes a hardware note-on/off pair to the Faust instrument and never to the builtin synth', async () => {
            faust_instrument_types.value = new Set(['faust-rhodes']);
            const release = vi.fn();
            start_faust_note.mockReturnValue(release);
            const schedule_note = vi.fn(() => null);
            const getTrackStoreState = () => ({
                tracks: [{ id: 'track-1', devices: [{ id: 'faust-1', type: 'faust-rhodes' }] }],
                selectedTrackId: 'track-1',
            });
            const noteOff = handleWebMidiNoteOff._factory({
                getCompensationDelay: () => 0,
                getTrackStoreState,
                getTransportStoreValue: () => ({ isRecording: false }),
                playheadPositionRef: { current: 0 },
                createMidiNote: () => ({ id: 'unused', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }),
                appendRecordedMidiNote: () => {},
                getSynthParamsForTrack: () => ({ release: 0.3 }),
                processRealtimeMidiInput: async () => [],
                stepRecordNoteOff: () => {},
                eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
            });
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({ getTrackStoreState, scheduleNote: schedule_note, handleWebMidiNoteOff: noteOff })
            );
            ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
            get_track_strip.mockReturnValue({ deviceNodes: [] });

            await fn(0, 64, 100);

            // The live control surface the piano-roll audition drives Faust
            // instruments with: pitch/velocity gate the device on. The channel
            // is not part of that surface — freq/gain/gate address the voice.
            expect(start_faust_note).toHaveBeenCalledWith('track-1', 'faust-1', 64, 100, LIVE_DISPATCH_FRAME / 48_000);
            expect(activeNotes.get(createWebMidiNoteKey(0, 64))?.faustRelease).toBe(release);
            // The timbre oracle: the note must not fall through to the default
            // builtin synth voice.
            expect(schedule_note).not.toHaveBeenCalled();

            await noteOff(0, 64);

            expect(release).toHaveBeenCalledTimes(1);
            expect(activeNotes.has(createWebMidiNoteKey(0, 64))).toBe(false);
        });

        it('plays the Faust instrument added after the track default builtin synth, as playback and export do', async () => {
            faust_instrument_types.value = new Set(['faust-rhodes']);
            const release = vi.fn();
            start_faust_note.mockReturnValue(release);
            const schedule_note = vi.fn();
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [
                            {
                                id: 'track-1',
                                devices: [
                                    { id: 'syn-1', type: 'builtin-synth-analog' },
                                    { id: 'faust-1', type: 'faust-rhodes' },
                                ],
                            },
                        ],
                        selectedTrackId: 'track-1',
                    }),
                    scheduleNote: schedule_note,
                })
            );
            ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

            await fn(0, 60, 100);

            expect(schedule_note).not.toHaveBeenCalled();
            expect(start_faust_note).toHaveBeenCalledTimes(1);
            expect(start_faust_note.mock.calls[0]?.[1]).toBe('faust-1');
            expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.osc).toBeUndefined();
            expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.faustRelease).toBe(release);
        });
    });

    it('voices a drained generated note-off through the voice its note-on captured (#4870)', async () => {
        let drainEvents: ((events: TestMidiEvent[]) => boolean | void) | undefined;
        const grand_boule_note_on = vi.fn<(note: number, velocity: number, sampleFrame?: number) => void>();
        const grand_boule_note_off =
            vi.fn<(note: number, sampleFrame?: number, velocity?: number, channel?: number) => void>();
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
                processRealtimeMidiInput: async (input: RealtimeMidiInput) => {
                    drainEvents = input.onDrainedEvents;
                    return [
                        {
                            timeSamples: 96_240,
                            noteInstanceId: 'arp-1:generated:1',
                            durationSamples: 33_600,
                            kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 },
                        },
                    ];
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
        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_240, 0);
        expect(drainEvents).toBeTypeOf('function');

        // Later, the idle drain hands back the note-off the arpeggiator queued
        // for a block no transport scheduler will ever process (transport
        // stopped, no active clip).
        drainEvents?.([
            {
                timeSamples: 129_840,
                noteInstanceId: 'arp-1:generated:1',
                kind: { type: 'noteOff', channel: 0, note: 67 },
            },
        ]);

        expect(grand_boule_note_off).toHaveBeenCalledWith(67, 129_840, undefined, 0);
    });

    it('stops voicing drained events after the input was reset (#4870)', async () => {
        let drainEvents: ((events: TestMidiEvent[]) => boolean | void) | undefined;
        const grand_boule_note_off = vi.fn();
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
                processRealtimeMidiInput: async (input: RealtimeMidiInput) => {
                    drainEvents = input.onDrainedEvents;
                    return [
                        {
                            timeSamples: 96_240,
                            noteInstanceId: 'arp-1:generated:1',
                            kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 },
                        },
                    ];
                },
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { noteOn: vi.fn(), noteOff: grand_boule_note_off },
                },
            ],
        });

        await fn(0, 60, 100);
        resetChannelControllerState();

        // A stale pump's batch after the reset voices nothing and cancels the
        // drain that produced it.
        expect(drainEvents?.([{ timeSamples: 129_840, kind: { type: 'noteOff', channel: 0, note: 67 } }])).toBe(false);
        expect(grand_boule_note_off).not.toHaveBeenCalled();
    });

    it('honors a generated note lifetime on the builtin fallback voice instead of 0.5 s (#4870)', async () => {
        const schedule_note = vi.fn(() => null);
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'yeast-1', type: 'yeast' }] }],
                    selectedTrackId: 'track-1',
                }),
                scheduleNote: schedule_note,
                processRealtimeMidiInput: async () => [
                    {
                        timeSamples: 96_240,
                        noteInstanceId: 'arp-1:generated:1',
                        durationSamples: 33_600,
                        kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 },
                    },
                ],
            })
        );
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });

        await fn(0, 60, 100);

        // 33600 samples at 48 kHz — the arpeggiator's held lifetime — not the
        // fixed half-second the fallback used to clamp it to.
        expect(schedule_note).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            67,
            96_240 / 48_000,
            33_600 / 48_000,
            100,
            expect.anything()
        );
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

        it('sends a note-on to a carried built-in instrument instead of voicing it on Web Audio', async () => {
            const send_native_live_midi_note = vi.fn(async () => true);
            const fermenter_note_on = vi.fn();
            const fn = handleWebMidiNoteOn._factory(
                make_dependencies({
                    getTrackStoreState: () => ({
                        tracks: [{ id: 'track-1', devices: [{ id: 'ferm-1', type: 'fermenter' }] }],
                        selectedTrackId: 'track-1',
                    }),
                    isDeviceCarriedByNativeSession: (trackId: string, deviceId: string) =>
                        trackId === 'track-1' && deviceId === 'ferm-1',
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
            expect(send_native_live_midi_note).toHaveBeenCalledWith({
                trackId: 'track-1',
                deviceId: 'ferm-1',
                note: 60,
                velocity: 100,
                channel: 0,
                isNoteOn: true,
            });
            expect(fermenter_note_on).not.toHaveBeenCalled();
            expect(activeNotes.get(createWebMidiNoteKey(0, 60))?.nativeDeviceId).toBe('ferm-1');
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
