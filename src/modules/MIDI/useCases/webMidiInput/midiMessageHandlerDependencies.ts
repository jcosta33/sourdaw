import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import {
    getCompensationDelay,
    getFactoryDrumKitByIndex,
    isDeviceCarriedByNativeSession,
    sendNativeLiveMidiControl,
    sendNativeLiveMidiNote,
    soundsNativeNotes,
} from '#/modules/AudioEngine/useCases';
import {
    getDrumKitDefByIndex,
    getSynthParamsFromDevices,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNote,
} from '#/modules/Synth/useCases';
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

function getSynthParamsForTrack(trackId: string): ReturnType<typeof getSynthParamsFromDevices> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return getSynthParamsFromDevices(track?.devices ?? []);
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
