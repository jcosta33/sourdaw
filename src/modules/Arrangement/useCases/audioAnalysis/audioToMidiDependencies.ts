import { addMidiNote } from '#/modules/MIDI/useCases';
import { addTrack } from '../addTrack';
import { addClip } from '../clip/addClip';

export const audioToMidiDependencies = {
    addTrack,
    addClip,
    addMidiNote,
} as const;