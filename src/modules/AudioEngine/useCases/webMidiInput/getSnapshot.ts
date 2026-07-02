import { getSnapshot as getWebMidiSnapshot } from '../../repositories/webMidi/getSnapshot';

export function getSnapshot(...args: Parameters<typeof getWebMidiSnapshot>): ReturnType<typeof getWebMidiSnapshot> {
    return getWebMidiSnapshot(...args);
}
