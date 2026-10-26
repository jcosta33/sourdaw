import { type Clip } from './Track';
import { type MidiTakeSource } from './TakeLane';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
    /** Selected take's original MIDI owner; absent for base gaps and legacy takes. */
    midiTakeSource?: MidiTakeSource;
    midiTakeId?: string;
};
