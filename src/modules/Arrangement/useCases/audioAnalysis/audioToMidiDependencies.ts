import { addMidiNote } from '#/modules/MIDI/useCases';
import { addTrack } from '../addTrack';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';

export const audioToMidiDependencies = {
    addTrack,
    addClip,
    addMidiNote,
} as const;