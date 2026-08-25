import { describe, it, expect } from 'vitest';

import { getMidiLearnDependencies } from '../getMidiLearnDependencies';
import {
    midiLearnDependenciesHolder,
    setMidiLearnDependencies,
    type MidiLearnDependencies,
} from '../midiLearnDependencies';

const stubDeps: MidiLearnDependencies = {
    clampTrackGain: (gain) => gain,
    setTrackGainArrangement: () => {},
    setTrackPanArrangement: () => {},
    setDeviceParameter: () => {},
    engineSetTrackGain: () => {},
    engineSetTrackPan: () => {},
    setFermenterMappedParam: () => {},
    recordAutomationValue: () => {},
    getTransportIsPlaying: () => false,
    getTransportPlayheadPosition: () => 0,
    getAllTracks: () => [],
};

describe('getMidiLearnDependencies', () => {
    it('throws when no dependencies have been registered yet', () => {
        midiLearnDependenciesHolder.current = null;

        expect(() => getMidiLearnDependencies()).toThrow('MIDI learn dependencies not initialized');
    });

    it('returns the dependencies registered via setMidiLearnDependencies', () => {
        setMidiLearnDependencies(stubDeps);

        expect(getMidiLearnDependencies()).toBe(stubDeps);
    });
});
