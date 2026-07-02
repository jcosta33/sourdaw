import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import {
    appendRecordedMidiNote,
    completeMidiLearn,
    createMidiNote,
    getMidiLearnState,
    handleMidiMessage as applyMidiMappings,
    stepRecordNoteOff,
    stepRecordNoteOn,
} from '#/modules/MIDI/useCases';
import {
    getDrumKitDefByIndex,
    getSynthParamsFromDevices,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNote,
} from '#/modules/Synth/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { processRealtimeMidiInput } from '#/modules/Yeast/useCases';

import { getDrumKitByIndex } from '../../models/FactoryDrumKits';
import { WebMidiEventBus } from '../../repositories/webMidi/webMidiEventBus';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

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
    getCompensationDelay,
    getDrumKitByIndex,
    getDrumKitDefByIndex,
    getMidiLearnState,
    getSynthParamsForTrack,
    getTrackStoreState,
    getTransportStoreValue,
    playheadPositionRef,
    processRealtimeMidiInput,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNote,
    stepRecordNoteOff,
    stepRecordNoteOn,
};
