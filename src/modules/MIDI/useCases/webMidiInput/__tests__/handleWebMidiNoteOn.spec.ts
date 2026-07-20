import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const target_track_id = vi.hoisted(() => ({ value: 'track-1' }));
const mpe_enabled = vi.hoisted(() => ({ value: false }));
const ensure_track_strip = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());

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
        context: { currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 },
        ensureTrackStrip: ensure_track_strip,
        getTrackStrip: get_track_strip,
    },
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
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
        ...overrides,
    };
}

describe('handleWebMidiNoteOn', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        ensure_track_strip.mockReset();
        get_track_strip.mockReset();
        target_track_id.value = 'track-1';
        mpe_enabled.value = false;
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

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_240);
        expect(grand_boule_note_off).toHaveBeenCalledWith(67, 96_480);
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

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_240);
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

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127, 96_000);
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

        await fn(1, 60, 100);

        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(1, 60, 0);
        expect(activeNotes.get(key)).toEqual(expect.objectContaining({ trackId: 'track-1', startTime: 2 }));
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

        expect(release).toHaveBeenCalledWith(3, 60, 0);
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
});
