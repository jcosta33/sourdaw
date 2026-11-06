import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import {
    builtinSynthVoice,
    getCompensationDelay,
    getFactoryDrumKitByIndex,
    isDeviceCarriedByNativeSession,
    sendNativeLiveMidiControl,
    sendNativeLiveMidiNote,
    soundsNativeNotes,
} from '#/modules/AudioEngine/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { processRealtimeMidiInput } from '../../repositories/webMidi/processRealtimeMidiInput';
import { WebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';
import { appendRecordedMidiNote } from '../appendRecordedMidiNote';
import { createMidiNote } from '../createMidiNote';
import { bufferRecordedMidiCC } from '../recordedControllerTake/bufferRecordedMidiCC';
import { bufferRecordedMidiPitchBend } from '../recordedControllerTake/bufferRecordedMidiPitchBend';
import { stepRecordNoteOff } from '../stepRecording/stepRecordNoteOff';
import { stepRecordNoteOn } from '../stepRecording/stepRecordNoteOn';

import { midiLearnRouting } from './midiLearnRouting';
import { panicLiveNotes } from './panicLiveNotes';

function getTrackStoreState(): TrackStoreState | null {
    return trackStore.value;
}

function getTransportStoreValue() {
    return transportStore.value;
}

const MIDI_LEARN_CALLER = 'midiMessageHandlerDependencies';

function getMidiLearnState() {
    return midiLearnRouting.read(MIDI_LEARN_CALLER).getMidiLearnState();
}

function completeMidiLearn(channel: number, cc: number): void {
    midiLearnRouting.read(MIDI_LEARN_CALLER).completeMidiLearn(channel, cc);
}

function applyMidiMappings(channel: number, cc: number, value: number, normalized?: number): void {
    midiLearnRouting.read(MIDI_LEARN_CALLER).applyMidiMappings(channel, cc, value, normalized);
}

const SYNTH_VOICE_CALLER = 'midiMessageHandlerDependencies';

type BuiltinSynthVoice = ReturnType<typeof builtinSynthVoice.read>;
type ScheduleNoteInput = Parameters<BuiltinSynthVoice['scheduleNote']>;
type ScheduleKitNoteInput = Parameters<BuiltinSynthVoice['scheduleKitNote']>;
type ScheduleDrumKitNoteInput = Parameters<BuiltinSynthVoice['scheduleDrumKitNote']>;

function readSynthVoice(): BuiltinSynthVoice {
    return builtinSynthVoice.read(SYNTH_VOICE_CALLER);
}

function getSynthParamsForTrack(trackId: string): ReturnType<BuiltinSynthVoice['getSynthParamsFromDevices']> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return readSynthVoice().getSynthParamsFromDevices(track?.devices ?? []);
}

function getDrumKitDefByIndex(index: number): ReturnType<BuiltinSynthVoice['getDrumKitDefByIndex']> {
    return readSynthVoice().getDrumKitDefByIndex(index);
}

// The voice is read when a note sounds, never when this module loads, and each
// wrapper forwards its arguments one by one so a live note allocates nothing.
function scheduleNote(
    ctx: ScheduleNoteInput[0],
    destination: ScheduleNoteInput[1],
    pitch: ScheduleNoteInput[2],
    startTime: ScheduleNoteInput[3],
    duration: ScheduleNoteInput[4],
    velocity: ScheduleNoteInput[5],
    params: ScheduleNoteInput[6],
    mpe?: ScheduleNoteInput[7],
    clipGain?: ScheduleNoteInput[8]
): ReturnType<BuiltinSynthVoice['scheduleNote']> {
    return readSynthVoice().scheduleNote(ctx, destination, pitch, startTime, duration, velocity, params, mpe, clipGain);
}

function scheduleKitNote(
    ctx: ScheduleKitNoteInput[0],
    destination: ScheduleKitNoteInput[1],
    kit: ScheduleKitNoteInput[2],
    pitch: ScheduleKitNoteInput[3],
    startTime: ScheduleKitNoteInput[4],
    duration: ScheduleKitNoteInput[5],
    velocity: ScheduleKitNoteInput[6],
    clipGain: ScheduleKitNoteInput[7],
    kitGain: ScheduleKitNoteInput[8]
): ReturnType<BuiltinSynthVoice['scheduleKitNote']> {
    return readSynthVoice().scheduleKitNote(
        ctx,
        destination,
        kit,
        pitch,
        startTime,
        duration,
        velocity,
        clipGain,
        kitGain
    );
}

function scheduleDrumKitNote(
    ctx: ScheduleDrumKitNoteInput[0],
    destination: ScheduleDrumKitNoteInput[1],
    kit: ScheduleDrumKitNoteInput[2],
    midiNote: ScheduleDrumKitNoteInput[3],
    startTime: ScheduleDrumKitNoteInput[4],
    velocity: ScheduleDrumKitNoteInput[5],
    clipGain: ScheduleDrumKitNoteInput[6],
    kitGain: ScheduleDrumKitNoteInput[7]
): void {
    readSynthVoice().scheduleDrumKitNote(ctx, destination, kit, midiNote, startTime, velocity, clipGain, kitGain);
}

export const midiMessageHandlerDependencies = {
    appendRecordedMidiNote,
    applyMidiMappings,
    bufferRecordedMidiCC,
    bufferRecordedMidiPitchBend,
    completeMidiLearn,
    createMidiNote,
    eventBus: WebMidiEventBus,
    getCompensationDelay: (trackId: string) => getCompensationDelay(trackId),
    getDrumKitByIndex: (index: number) => getFactoryDrumKitByIndex(index),
    getDrumKitDefByIndex,
    getMidiLearnState,
    getSynthParamsForTrack,
    getTrackStoreState,
    getTransportStoreValue,
    isDeviceCarriedByNativeSession,
    panicLiveNotes,
    playheadPositionRef,
    processRealtimeMidiInput,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNote,
    sendNativeLiveMidiControl,
    sendNativeLiveMidiNote,
    soundsNativeNotes,
    stepRecordNoteOff,
    stepRecordNoteOn,
};
