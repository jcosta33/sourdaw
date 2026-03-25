/**
 * Barrel re-export — webMidiInput logic moved to repositories/webMidi.ts.
 * Import from the repository directly when possible.
 */

export {
    type MidiInputInfo,
    setMpeEnabled,
    getMpeEnabled,
    subscribe,
    getSnapshot,
    initWebMidi,
    getAvailableMidiInputs,
    selectMidiInput,
    setMidiInputTrack,
    startMidiLearnLegacy,
    stopMidiLearnLegacy,
    resetMidiState,
    destroyWebMidi,
} from '../repositories/webMidi';
