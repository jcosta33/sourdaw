import { setMidiInputTrack as setWebMidiInputTrack } from '../../repositories/webMidi/lifecycle/setMidiInputTrack';

export function setMidiInputTrack(
    ...args: Parameters<typeof setWebMidiInputTrack>
): ReturnType<typeof setWebMidiInputTrack> {
    return setWebMidiInputTrack(...args);
}