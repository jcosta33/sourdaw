import { type MidiLearnDependencies, midiLearnDependenciesHolder } from './midiLearnDependencies';

export function getMidiLearnDependencies(): MidiLearnDependencies {
    if (!midiLearnDependenciesHolder.current) {
        throw new Error('MIDI learn dependencies not initialized');
    }
    return midiLearnDependenciesHolder.current;
}
