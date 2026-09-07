import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import {
    getCompensationDelay,
    getFactoryDrumKitByIndex,
    isDeviceCarriedByNativeSession,
    sendNativeLiveMidiNote,
    soundsNativeNotes,
} from '#/modules/AudioEngine/useCases';
import {
    completeMidiLearn,
    getMidiLearnState,
    handleMidiMessage as applyMidiMappings,
} from '#/modules/ControlSurface/useCases';
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
import { stepRecordNoteOff } from '../stepRecording/stepRecordNoteOff';
import { stepRecordNoteOn } from '../stepRecording/stepRecordNoteOn';

import { panicLiveNotes } from './panicLiveNotes';

function getTrackStoreState(): TrackStoreState | null {
    return trackStore.value;
}

function getTransportStoreValue() {
    return transportStore.value;
}

function getSynthParamsForTrack(trackId: string): ReturnType<typeof getSynthParamsFromDevices> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return getSynthParamsFromDevices(track?.devices ?? []);
}

export const midiMessageHandlerDependencies = {
    appendRecordedMidiNote,
    applyMidiMappings,
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
    sendNativeLiveMidiNote,
    soundsNativeNotes,
    stepRecordNoteOff,
    stepRecordNoteOn,
};
