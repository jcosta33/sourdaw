import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const clock = vi.hoisted(() => ({ currentTime: 1, sampleRate: 48_000, baseLatency: 0, outputLatency: 0 }));
const noteOnControl = vi.hoisted(() => vi.fn());
const noteOffControl = vi.hoisted(() => vi.fn());
const otherNoteOnControl = vi.hoisted(() => vi.fn());
const otherNoteOffControl = vi.hoisted(() => vi.fn());
const reorderedNoteOnControl = vi.hoisted(() => vi.fn());
const reorderedNoteOffControl = vi.hoisted(() => vi.fn());
const target = vi.hoisted(() => ({ value: 'track-1' }));
const strip = vi.hoisted(() => ({
    gainNode: {},
    deviceNodes: [
        {
            deviceId: 'fermenter-1',
            type: 'fermenter',
            fermenterControls: { noteOn: noteOnControl, noteOff: noteOffControl },
        },
    ],
}));
const otherStrip = vi.hoisted(() => ({
    gainNode: {},
    deviceNodes: [
        {
            deviceId: 'fermenter-2',
            type: 'fermenter',
            fermenterControls: { noteOn: otherNoteOnControl, noteOff: otherNoteOffControl },
        },
    ],
}));
const applyNoteExpression = vi.hoisted(() => vi.fn());

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: clock,
        ensureTrackStrip: (trackId: string) => (trackId === 'track-2' ? otherStrip : strip),
        getTrackStrip: (trackId: string) => (trackId === 'track-2' ? otherStrip : strip),
    },
    getCompensationDelay: () => 0,
    getDefaultBendRangeSemitones: () => 48,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: () => false,
    startFaustNote: () => () => {},
    applyNoteExpression,
}));
vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({ getTargetTrackId: () => target.value }));
vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({ getMpeEnabled: () => true }));

const { handleWebMidiNoteOn } = await import('../handleWebMidiNoteOn');
const { handleWebMidiNoteOff } = await import('../handleWebMidiNoteOff');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');
const { resetMidiState } = await import('../../../repositories/webMidi/lifecycle/resetMidiState');

describe('live Yeast release ownership across input reset', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        noteOnControl.mockReset();
        noteOffControl.mockReset();
        otherNoteOnControl.mockReset();
        otherNoteOffControl.mockReset();
        reorderedNoteOnControl.mockReset();
        reorderedNoteOffControl.mockReset();
        strip.deviceNodes.splice(0, strip.deviceNodes.length, {
            deviceId: 'fermenter-1',
            type: 'fermenter',
            fermenterControls: { noteOn: noteOnControl, noteOff: noteOffControl },
        });
        target.value = 'track-1';
        clock.currentTime = 1;
    });

    it('releases the original control and completes recording when the note-off worker fails', async () => {
        const recorded: Array<{ pitch: number; duration: number }> = [];
        const deps = {
            getCompensationDelay: () => 0,
            getTrackStoreState: () => ({
                tracks: [
                    {
                        id: 'track-1',
                        armed: true,
                        devices: [
                            { id: 'yeast-1', type: 'yeast' },
                            { id: 'fermenter-1', type: 'fermenter' },
                        ],
                        clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 8 }],
                    },
                ],
                selectedTrackId: 'track-1',
            }),
            getTransportStoreValue: () => ({ isRecording: true, overdubEnabled: false, isLooping: false, tempo: 120 }),
            playheadPositionRef: { current: 0 },
            createMidiNote: (pitch: number, startBeat: number, duration: number, velocity: number) => ({
                id: 'recorded',
                pitch,
                startBeat,
                duration,
                velocity,
            }),
            appendRecordedMidiNote: ({ note }: { note: { pitch: number; duration: number } }) => {
                recorded.push(note);
            },
            getSynthParamsForTrack: () => ({ release: 0.3 }),
            processRealtimeMidiInput: async (request: { isNoteOn: boolean }) => {
                if (!request.isNoteOn) {
                    throw new Error('worker offline');
                }
                return [
                    { timeSamples: 48_000, kind: { type: 'noteOn' as const, channel: 1, note: 67, velocity: 100 } },
                ];
            },
            stepRecordNoteOn: () => {},
            stepRecordNoteOff: () => {},
            eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
            scheduleNote: () => null,
            scheduleKitNote: () => null,
            getDrumKitByIndex: () => null,
            getDrumKitDefByIndex: () => null,
            scheduleDrumKitNote: () => {},
            isDeviceCarriedByNativeSession: () => false,
            sendNativeLiveMidiNote: async () => true,
            soundsNativeNotes: () => false,
        };
        const release = handleWebMidiNoteOff._factory(deps);
        const strike = handleWebMidiNoteOn._factory({ ...deps, handleWebMidiNoteOff: release });
        await strike(1, 60, 100);
        expect(noteOnControl).toHaveBeenCalledTimes(1);
        clock.currentTime = 2;
        await release(1, 60);
        expect(noteOffControl).toHaveBeenCalledTimes(1);
        expect(noteOffControl).toHaveBeenCalledWith(67, undefined, 1);
        expect(recorded).toEqual([expect.objectContaining({ pitch: 60, duration: 2 })]);
        await strike(1, 60, 100);
        expect(noteOffControl).toHaveBeenCalledTimes(1);
    });

    it('preserves a fresh transformed voice when the old worker release finishes late, and completes old recording', async () => {
        let finishOldRelease!: (
            events: { timeSamples: number; kind: { type: 'noteOff'; channel: number; note: number } }[]
        ) => void;
        const oldRelease = new Promise<
            { timeSamples: number; kind: { type: 'noteOff'; channel: number; note: number } }[]
        >((resolve) => {
            finishOldRelease = resolve;
        });
        let finishLoneRelease!: (
            events: { timeSamples: number; kind: { type: 'noteOff'; channel: number; note: number } }[]
        ) => void;
        const loneRelease = new Promise<
            { timeSamples: number; kind: { type: 'noteOff'; channel: number; note: number } }[]
        >((resolve) => {
            finishLoneRelease = resolve;
        });
        const workerRequests: Array<{ isNoteOn: boolean; noteInstanceId?: string }> = [];
        const recorded: Array<{ duration: number }> = [];
        const track = {
            id: 'track-1',
            armed: true,
            devices: [
                { id: 'yeast-1', type: 'yeast' },
                { id: 'fermenter-1', type: 'fermenter' },
            ],
            clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 8 }],
        };
        const otherTrack = {
            id: 'track-2',
            armed: false,
            devices: [
                { id: 'yeast-2', type: 'yeast' },
                { id: 'fermenter-2', type: 'fermenter' },
            ],
            clips: [{ id: 'clip-2', type: 'midi', startBeat: 0, endBeat: 8 }],
        };
        const deps = {
            getCompensationDelay: () => 0,
            getTrackStoreState: () => ({ tracks: [track, otherTrack], selectedTrackId: target.value }),
            getTransportStoreValue: () => ({ isRecording: true, overdubEnabled: false, isLooping: false, tempo: 120 }),
            playheadPositionRef: { current: 0 },
            createMidiNote: (pitch: number, startBeat: number, duration: number, velocity: number) => ({
                id: `recorded-${recorded.length}`,
                pitch,
                startBeat,
                duration,
                velocity,
            }),
            appendRecordedMidiNote: ({ note }: { note: { duration: number } }) => {
                recorded.push(note);
            },
            getSynthParamsForTrack: () => ({ release: 0.3 }),
            processRealtimeMidiInput: async (request: { isNoteOn: boolean; noteInstanceId?: string }) => {
                workerRequests.push(request);
                if (!request.isNoteOn) {
                    const releaseNumber = workerRequests.filter((entry) => !entry.isNoteOn).length;
                    if (releaseNumber === 1) {
                        return oldRelease;
                    }
                    if (releaseNumber === 3) {
                        return loneRelease;
                    }
                }
                return [
                    {
                        timeSamples:
                            Math.round(clock.currentTime * clock.sampleRate) +
                            (request.isNoteOn && workerRequests.filter((entry) => entry.isNoteOn).length === 2
                                ? 256
                                : 0),
                        kind: {
                            type: request.isNoteOn ? ('noteOn' as const) : ('noteOff' as const),
                            channel: 1,
                            note: 67,
                            velocity: 100,
                        },
                    },
                ];
            },
            stepRecordNoteOn: () => {},
            stepRecordNoteOff: () => {},
            eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
            scheduleNote: () => null,
            scheduleKitNote: () => null,
            getDrumKitByIndex: () => null,
            getDrumKitDefByIndex: () => null,
            scheduleDrumKitNote: () => {},
            isDeviceCarriedByNativeSession: () => false,
            sendNativeLiveMidiNote: async () => true,
            soundsNativeNotes: () => false,
        };
        const release = handleWebMidiNoteOff._factory(deps);
        const strike = handleWebMidiNoteOn._factory({ ...deps, handleWebMidiNoteOff: release });
        vi.doMock('../handleWebMidiNoteOn', () => ({ handleWebMidiNoteOn: strike }));
        vi.doMock('../handleWebMidiNoteOff', () => ({ handleWebMidiNoteOff: release }));
        const { handleWebMidiMessage } = await import('../handleWebMidiMessage');
        const send = (bytes: number[]) => handleWebMidiMessage({ data: new Uint8Array(bytes), timeStamp: undefined });

        await send([0x91, 60, 100]);
        const oldId = activeNotes.get(createWebMidiNoteKey(1, 60))?.noteInstanceId;
        clock.currentTime = 2;
        const oldOff = send([0x81, 60, 0]);
        await vi.waitFor(() => expect(workerRequests.filter((request) => !request.isNoteOn)).toHaveLength(1));
        resetMidiState({
            getCurrentTime: () => clock.currentTime,
            getTrackStrip: () => strip,
            releaseNativeNote: () => {},
        });

        strip.deviceNodes.unshift({
            deviceId: 'fermenter-reordered',
            type: 'fermenter',
            fermenterControls: { noteOn: reorderedNoteOnControl, noteOff: reorderedNoteOffControl },
        });

        clock.currentTime = 2.1;
        await send([0x91, 60, 100]);
        const newId = activeNotes.get(createWebMidiNoteKey(1, 60))?.noteInstanceId;
        expect(newId).toBeDefined();
        expect(newId).not.toBe(oldId);
        expect(noteOnControl).toHaveBeenCalledTimes(1);
        expect(reorderedNoteOnControl).toHaveBeenCalledTimes(1);
        expect(noteOffControl).toHaveBeenLastCalledWith(67, 101_056, 1);
        expect(noteOffControl.mock.invocationCallOrder.at(-1)).toBeLessThan(
            reorderedNoteOnControl.mock.invocationCallOrder[0]!
        );
        expect(reorderedNoteOffControl).not.toHaveBeenCalled();
        const offsBeforeOldWorker = noteOffControl.mock.calls.length;

        finishOldRelease([{ timeSamples: 96_000, kind: { type: 'noteOff', channel: 1, note: 67 } }]);
        await oldOff;
        expect(noteOffControl).toHaveBeenCalledTimes(offsBeforeOldWorker);
        expect(reorderedNoteOffControl).not.toHaveBeenCalled();
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.noteInstanceId).toBe(newId);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.duration).toBe(2);

        clock.currentTime = 3;
        await send([0x81, 60, 0]);
        expect(reorderedNoteOffControl).toHaveBeenLastCalledWith(67, expect.any(Number), 1);
        expect(activeNotes.size).toBe(0);
        strip.deviceNodes.shift();

        clock.currentTime = 3.5;
        await send([0x91, 62, 100]);
        clock.currentTime = 4;
        const loneOff = send([0x81, 62, 0]);
        await vi.waitFor(() => expect(workerRequests.filter((request) => !request.isNoteOn)).toHaveLength(3));
        resetMidiState({
            getCurrentTime: () => clock.currentTime,
            getTrackStrip: () => strip,
            releaseNativeNote: () => {},
        });
        target.value = 'track-2';
        clock.currentTime = 4.1;
        await send([0x91, 62, 100]);
        expect(otherNoteOnControl).toHaveBeenCalledWith(67, 100, expect.any(Number), 1);
        const offsBeforeLoneWorker = noteOffControl.mock.calls.length;
        finishLoneRelease([{ timeSamples: 192_000, kind: { type: 'noteOff', channel: 1, note: 67 } }]);
        await loneOff;
        expect(noteOffControl).toHaveBeenCalledTimes(offsBeforeLoneWorker + 1);
        expect(noteOffControl).toHaveBeenLastCalledWith(67, expect.any(Number), 1);
        expect(otherNoteOffControl).not.toHaveBeenCalled();
        expect(recorded).toHaveLength(3);

        resetMidiState({
            getCurrentTime: () => clock.currentTime,
            getTrackStrip: (trackId) => (trackId === 'track-2' ? otherStrip : strip),
            releaseNativeNote: () => {},
        });
        expect(otherNoteOffControl).toHaveBeenCalledWith(67, undefined, 1);
        expect(activeNotes.size).toBe(0);
    });
});
