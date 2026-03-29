/**
 * Barrel re-export — webMidiInput logic moved to repositories/webMidi.ts.
 * Import from the repository directly when possible.
 */

export {
    type MidiInputInfo,
    setMpeEnabled,
    subscribe,
    getSnapshot,
    initWebMidi,
    selectMidiInput,
    setMidiInputTrack,
    resetMidiState,
} from '../repositories/webMidi';
