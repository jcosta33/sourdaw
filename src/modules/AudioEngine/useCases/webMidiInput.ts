/**
 * Barrel re-export — webMidiInput logic moved to repositories/webMidi.ts.
 * Import from the repository directly when possible.
 */

export { type MidiInputInfo } from '../models/WebMidiTypes';
export { subscribe, getSnapshot } from '../repositories/webMidi/state';
export {
    initWebMidi,
    selectMidiInput,
    setMidiInputTrack,
    setMpeEnabled,
    resetMidiState,
} from '../repositories/webMidi/lifecycle';
export { webMidiStore } from '../repositories/webMidi/store';
